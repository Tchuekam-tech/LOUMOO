-- Additive public discovery. Apply once after migrations 001..013.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION iam.search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT trim(regexp_replace(translate(lower(replace(replace(coalesce(value,''),'œ','oe'),'æ','ae')),
 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'),'[^a-z0-9]+',' ','g'));
$$;
ALTER TABLE iam.listings ADD COLUMN IF NOT EXISTS search_name text GENERATED ALWAYS AS (iam.search_normalize(title)) STORED;
ALTER TABLE iam.listings ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
 setweight(to_tsvector('simple',iam.search_normalize(title||' '||coalesce(brand,'')||' '||coalesce(model,''))),'A') ||
 setweight(to_tsvector('simple',iam.search_normalize(coalesce(short_description,'')||' '||coalesce(description,''))),'B')) STORED;
ALTER TABLE iam.stores ADD COLUMN IF NOT EXISTS search_name text GENERATED ALWAYS AS (iam.search_normalize(name)) STORED;
ALTER TABLE iam.stores ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',iam.search_normalize(name||' '||coalesce(description,'')))) STORED;
ALTER TABLE iam.hotels ADD COLUMN IF NOT EXISTS search_name text GENERATED ALWAYS AS (iam.search_normalize(name)) STORED;
ALTER TABLE iam.hotels ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',iam.search_normalize(name||' hotel '||city||' '||coalesce(description,'')))) STORED;
ALTER TABLE iam.transport_services ADD COLUMN IF NOT EXISTS search_name text GENERATED ALWAYS AS (iam.search_normalize(type||' '||origin||' '||destination)) STORED;
ALTER TABLE iam.transport_services ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',iam.search_normalize(type||' '||origin||' '||destination||' '||coalesce(service_number,'')))) STORED;
ALTER TABLE iam.announcements ADD COLUMN IF NOT EXISTS search_name text GENERATED ALWAYS AS (iam.search_normalize(title)) STORED;
ALTER TABLE iam.announcements ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',iam.search_normalize(title||' '||body||' '||type))) STORED;
DO $$ DECLARE t text; ext_schema text; BEGIN
 SELECT n.nspname INTO ext_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
 FOREACH t IN ARRAY ARRAY['listings','stores','hotels','transport_services','announcements'] LOOP
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON iam.%I USING gin(search_vector)','idx_search_'||t||'_fts',t);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON iam.%I USING gin(search_name %I.gin_trgm_ops)','idx_search_'||t||'_typo',t,ext_schema);
 END LOOP;
END $$;
CREATE OR REPLACE VIEW iam.public_search_documents AS
SELECT l.id::text,CASE WHEN l.listing_type IN ('SERVICE','BOOKING','RENTAL') THEN 'service' ELSE 'product' END AS entity_type,
 l.title::text,l.slug::text,left(coalesce(l.short_description,l.description,''),600) AS description,
 l.search_name,l.search_vector,l.category_id::text AS category,c.vertical::text,l.brand::text,l.condition::text,
 CASE WHEN l.has_variants THEN (SELECT min(v.price_minor) FROM iam.listing_variants v WHERE v.listing_id=l.id AND v.is_active)
 ELSE coalesce(l.sale_price_minor,l.base_price_minor) END::numeric AS price,
 l.currency::text,sl.city::text,s.is_verified AS verified,CASE WHEN l.rating_count>0 THEN l.rating ELSE NULL END AS rating,
 CASE WHEN l.listing_type IN ('SERVICE','BOOKING','RENTAL') THEN NULL
 WHEN l.has_variants THEN (SELECT bool_or(v.stock_quantity>v.reserved_quantity) FROM iam.listing_variants v WHERE v.listing_id=l.id AND v.is_active)
 ELSE (SELECT bool_or(NOT i.track_inventory OR i.on_hand>i.reserved) FROM iam.listing_inventory i WHERE i.listing_id=l.id AND i.variant_id IS NULL) END AS in_stock,
 s.id::text AS store_id,s.name::text AS store_name,
 (SELECT m.url FROM iam.listing_media m WHERE m.listing_id=l.id AND m.media_type='IMAGE' ORDER BY m.is_cover DESC,m.display_order,m.id LIMIT 1) AS image_url,
 coalesce(l.published_at,l.created_at) AS published_at,NULL::timestamptz AS expires_at,NULL::text AS origin,NULL::text AS destination,NULL::text AS transport_type,l.has_variants AS price_from
FROM iam.listings l JOIN iam.stores s ON s.id=l.store_id JOIN iam.listing_categories c ON c.id=l.category_id
LEFT JOIN iam.store_locations sl ON sl.store_id=s.id AND sl.is_public
WHERE l.status='PUBLISHED' AND l.visibility='PUBLIC' AND l.deleted_at IS NULL AND c.is_active
 AND s.status='ACTIVE' AND s.visibility='PUBLIC' AND s.deleted_at IS NULL AND s.id NOT LIKE 'store_test_%' AND s.name !~* 'test\s*boutique'
UNION ALL
SELECT s.id,'store',s.name,s.slug,left(coalesce(s.description,''),600),s.search_name,s.search_vector,s.category_id,NULL,NULL,NULL,NULL,'XAF',sl.city,s.is_verified,
 CASE WHEN s.rating_count>0 THEN s.rating ELSE NULL END,NULL,s.id,s.name,s.logo_url,s.created_at,NULL,NULL,NULL,NULL,false
FROM iam.stores s LEFT JOIN iam.store_locations sl ON sl.store_id=s.id AND sl.is_public
WHERE s.status='ACTIVE' AND s.visibility='PUBLIC' AND s.deleted_at IS NULL AND s.id NOT LIKE 'store_test_%' AND s.name !~* 'test\s*boutique'
UNION ALL
SELECT h.id,'hotel',h.name,h.id,left(coalesce(h.description,''),600),h.search_name,h.search_vector,'hotels','hotels',NULL,NULL,h.price_from,h.currency,h.city,true,NULL,NULL,NULL,p.name,
 CASE WHEN jsonb_typeof(h.images->0)='string' THEN h.images->>0 ELSE h.images->0->>'url' END,h.created_at,NULL,NULL,NULL,NULL,true
FROM iam.hotels h JOIN iam.travel_providers p ON p.id=h.provider_id WHERE h.status='ACTIVE' AND p.verification_status='VERIFIED'
UNION ALL
SELECT t.id,'travel',concat_ws(' · ',p.name,t.origin||' → '||t.destination),t.id,t.class_name,t.search_name,t.search_vector,t.type,'travel',NULL,NULL,t.price,t.currency,t.origin,true,
 NULL,t.available_seats>0,NULL,p.name,p.logo,t.created_at,t.departure_time,t.origin,t.destination,t.type,false
FROM iam.transport_services t JOIN iam.travel_providers p ON p.id=t.provider_id
WHERE t.status IN ('SCHEDULED','BOARDING','DELAYED') AND t.departure_time>now() AND p.verification_status='VERIFIED'
UNION ALL
SELECT a.id,'announcement',a.title,a.slug,left(a.body,600),a.search_name,a.search_vector,lower(a.type),'announcements',NULL,NULL,NULL,'XAF',sl.city,coalesce(s.is_verified,false),
 NULL,NULL,s.id,s.name,a.media_urls->>0,coalesce(a.published_at,a.created_at),a.expires_at,NULL,NULL,NULL,false
FROM iam.announcements a LEFT JOIN iam.stores s ON s.id=a.store_id LEFT JOIN iam.store_locations sl ON sl.store_id=s.id AND sl.is_public
LEFT JOIN iam.announcement_targets atg ON atg.announcement_id=a.id
WHERE a.status='PUBLISHED' AND a.deleted_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())
 AND (a.published_at IS NULL OR a.published_at<=now()) AND coalesce(atg.audience_scope,'EVERYONE')='EVERYONE'
 AND (a.store_id IS NULL OR (s.status='ACTIVE' AND s.visibility='PUBLIC' AND s.deleted_at IS NULL));
REVOKE ALL ON iam.public_search_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON iam.public_search_documents TO service_role;
CREATE OR REPLACE FUNCTION iam.search_public(p_query text DEFAULT '',p_tsquery text DEFAULT '',p_filters jsonb DEFAULT '{}',p_page integer DEFAULT 1,p_limit integer DEFAULT 20,p_suggest boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,iam,extensions,public SET statement_timeout='2500ms' SET pg_trgm.word_similarity_threshold='0.4'
AS $$ DECLARE q text:=iam.search_normalize(left(p_query,200));tq tsquery;n integer:=least(greatest(coalesce(p_limit,20),1),40);pg integer:=least(greatest(coalesce(p_page,1),1),100);result jsonb;
BEGIN
 IF length(p_tsquery)>2000 THEN RAISE EXCEPTION 'Search expression too long'; END IF;
 tq:=CASE WHEN p_tsquery<>'' THEN to_tsquery('simple',p_tsquery) ELSE NULL END;
 WITH RECURSIVE cats AS (
 SELECT id FROM iam.listing_categories WHERE id=p_filters->>'category' OR slug=p_filters->>'category'
 UNION SELECT c.id FROM iam.listing_categories c JOIN cats ON c.parent_id=cats.id
 ),matched AS NOT MATERIALIZED (
 SELECT d.*,CASE WHEN d.search_name=q AND q<>'' THEN 10 ELSE 0 END+coalesce(ts_rank_cd(d.search_vector,tq),0)+CASE WHEN q<>'' THEN word_similarity(q,d.search_name) ELSE 0 END AS relevance
 FROM iam.public_search_documents d WHERE (q='' OR d.search_vector @@ tq OR (length(q)>=3 AND q <% d.search_name))
 AND (coalesce(p_filters->>'type','all')='all' OR d.entity_type=p_filters->>'type')
 AND (coalesce(p_filters->>'category','')='' OR d.category IN (SELECT id FROM cats) OR d.category=p_filters->>'category' OR d.vertical=p_filters->>'category')
 AND (coalesce(p_filters->>'vertical','')='' OR d.vertical=p_filters->>'vertical')
 AND (coalesce(p_filters->>'storeId','')='' OR d.store_id=p_filters->>'storeId')
 AND (coalesce(p_filters->>'brand','')='' OR iam.search_normalize(d.brand)=iam.search_normalize(p_filters->>'brand'))
 AND (coalesce(p_filters->>'condition','')='' OR d.condition=p_filters->>'condition')
 AND (coalesce(p_filters->>'city','')='' OR iam.search_normalize(d.city)=iam.search_normalize(p_filters->>'city'))
 AND (coalesce((p_filters->>'verified')::boolean,false)=false OR d.verified)
 AND (coalesce((p_filters->>'inStock')::boolean,false)=false OR d.in_stock IS TRUE)
 AND (p_filters->>'minPrice' IS NULL OR (d.currency='XAF' AND d.price>=(p_filters->>'minPrice')::numeric))
 AND (p_filters->>'maxPrice' IS NULL OR (d.currency='XAF' AND d.price<=(p_filters->>'maxPrice')::numeric))
 ),page_rows AS (
 SELECT * FROM matched ORDER BY CASE WHEN p_filters->>'sort'='price_asc' THEN price END ASC NULLS LAST,
 CASE WHEN p_filters->>'sort'='price_desc' THEN price END DESC NULLS LAST,CASE WHEN p_filters->>'sort'='rating' THEN rating END DESC NULLS LAST,
 CASE WHEN coalesce(p_filters->>'sort','relevance')='relevance' THEN relevance END DESC,published_at DESC,id,entity_type LIMIT n OFFSET (pg-1)*n
 ) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)-'search_vector'-'search_name'-'relevance') FROM page_rows r),'[]'::jsonb),
 'total',(SELECT count(*) FROM matched),'page',pg,'limit',n,'facets',CASE WHEN p_suggest THEN '{}'::jsonb ELSE jsonb_build_object(
 'types',coalesce((SELECT jsonb_object_agg(entity_type,num) FROM (SELECT entity_type,count(*) AS num FROM matched GROUP BY entity_type) f),'{}'::jsonb),
 'cities',coalesce((SELECT jsonb_agg(jsonb_build_object('value',city,'count',num)) FROM (SELECT city,count(*) AS num FROM matched WHERE city IS NOT NULL GROUP BY city ORDER BY num DESC,city LIMIT 15) f),'[]'::jsonb)) END) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION iam.search_public(text,text,jsonb,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION iam.search_public(text,text,jsonb,integer,integer,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
