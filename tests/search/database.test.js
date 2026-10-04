'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { PGlite } = require('@electric-sql/pglite'),
  { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const {
  parseSearch,
} = require('../../server/modules/search/domain/SearchQuery');
module.exports = async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA iam; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
   CREATE TABLE iam.profiles(id varchar(64) PRIMARY KEY); CREATE TABLE iam.organizations(id varchar(64) PRIMARY KEY);`);
    const folder = path.join(
      __dirname,
      '../../server/infrastructure/database/migrations',
    );
    for (const prefix of ['004_', '005_', '009_', '011_', '014_', '014_'])
      await db.exec(
        fs.readFileSync(
          path.join(
            folder,
            fs.readdirSync(folder).find((f) => f.startsWith(prefix)),
          ),
          'utf8',
        ),
      );
    await db.exec(`INSERT INTO iam.profiles VALUES ('seller');
   INSERT INTO iam.stores(id,owner_id,name,slug,status,is_verified,visibility) VALUES ('s1','seller','Tech Centre','tech','ACTIVE',true,'PUBLIC'),('s2','seller','Coastal Store','coastal','ACTIVE',false,'PUBLIC'),('private','seller','Private Store','private','ACTIVE',true,'PRIVATE');
   INSERT INTO iam.store_locations(store_id,city,street_address) VALUES ('s1','Yaoundé','Private street'),('s2','Douala','Private street');
   INSERT INTO iam.listing_categories(id,vertical,name,slug,parent_id) VALUES ('electronics','electronics','Electronics','electronics',null),('laptops','electronics','Computers','computers','electronics');
   INSERT INTO iam.listings(id,store_id,seller_id,category_id,title,slug,base_price_minor,sale_price_minor,status) VALUES
    ('p1','s1','seller','laptops','Dell Latitude Laptop','p1',500000,300000,'PUBLISHED'),('p2','s2','seller','laptops','Lenovo Ordinateur','p2',250000,null,'PUBLISHED'),('hidden','private','seller','laptops','Hidden laptop','hidden',500,null,'PUBLISHED'),('draft','s1','seller','laptops','Draft laptop','draft',500,null,'DRAFT');
   INSERT INTO iam.listing_inventory(listing_id,on_hand,reserved) VALUES ('p1',2,2);
   INSERT INTO iam.listing_media(listing_id,url,is_cover) VALUES ('p1','https://example.com/dell.jpg',true);
   INSERT INTO iam.announcements(id,author_id,store_id,title,slug,body,status,published_at,expires_at) VALUES
    ('a1','seller','s1','Réparation disponible','a1','Repair','PUBLISHED',now(),now()+interval '1 day'),('a2','seller','s1','Private repair','a2','Secret','PUBLISHED',now(),null),('a3','seller','s1','Expired repair','a3','Expired','PUBLISHED',now()-interval '2 days',now()-interval '1 day'),('a4','seller','s1','Future repair','a4','Future','PUBLISHED',now()+interval '1 day',null);
   INSERT INTO iam.announcement_targets(announcement_id,audience_scope) VALUES ('a2','FOLLOWERS');
   INSERT INTO iam.travel_providers(id,name,type,verification_status) VALUES ('provider','Voyages','hotel','VERIFIED');
   INSERT INTO iam.hotels(id,provider_id,name,location,city,latitude,longitude,price_from,images) VALUES ('h1','provider','Hôtel Soleil','Centre','Yaoundé',3.8,11.5,40000,'[{"url":"https://example.com/hotel.jpg"}]');
   INSERT INTO iam.transport_services(id,provider_id,type,origin,destination,departure_time,arrival_time,capacity,available_seats,price) VALUES
    ('t1','provider','bus','Douala','Yaoundé',now()+interval '2 days',now()+interval '3 days',30,4,6000),('t2','provider','bus','Douala','Yaoundé',now()-interval '2 days',now()-interval '1 day',30,4,6000);`);
    const search = async (raw = {}, suggest = false) => {
      const q = parseSearch(raw);
      return (
        await db.query(
          'SELECT iam.search_public($1,$2,$3::jsonb,$4,$5,$6) AS data',
          [q.q, q.tsquery, JSON.stringify(q.filters), q.page, q.limit, suggest],
        )
      ).rows[0].data;
    };
    assert.equal((await search({ q: 'laptop', type: 'product' })).total, 2);
    assert.equal((await search({ q: 'ordinateur', type: 'product' })).total, 2);
    assert.equal((await search({ q: 'latitdue' })).items[0].id, 'p1');
    const filtered = await search({
      q: 'laptop',
      city: 'yaounde',
      verified: true,
      maxPrice: 310000,
      type: 'product',
    });
    assert.equal(filtered.total, 1);
    const i = filtered.items[0];
    assert.equal(i.price, 300000);
    assert.equal(i.rating, null);
    assert.equal(i.in_stock, false);
    assert.equal(i.image_url, 'https://example.com/dell.jpg');
    assert.ok(!JSON.stringify(i).includes('Private street'));
    assert.equal((await search({ type: 'product', inStock: true })).total, 0);
    await db.exec(
      "UPDATE iam.listing_inventory SET reserved=0 WHERE listing_id='p1'",
    );
    assert.equal((await search({ type: 'product', inStock: true })).total, 1);
    assert.equal((await search({ type: 'hotel' })).items[0].price_from, true);
    assert.equal(
      (await search({ type: 'hotel' })).items[0].image_url,
      'https://example.com/hotel.jpg',
    );
    assert.deepEqual(
      (await search({ type: 'travel' })).items.map((i) => i.id),
      ['t1'],
    );
    assert.deepEqual(
      (await search({ type: 'announcement', q: 'repair' })).items.map(
        (i) => i.id,
      ),
      ['a1'],
    );
    assert.equal(
      (await search({ type: 'product', category: 'electronics' })).total,
      2,
    );
    assert.deepEqual(
      (await search({ type: 'product', sort: 'price_asc' })).items.map(
        (i) => i.id,
      ),
      ['p2', 'p1'],
    );
    await db.exec(`INSERT INTO iam.listings(id,store_id,seller_id,category_id,title,slug,has_variants,status) VALUES ('variant','s1','seller','laptops','Variant computer','variant',true,'PUBLISHED');
   INSERT INTO iam.listing_variants(listing_id,title,price_minor,stock_quantity,reserved_quantity,is_active) VALUES ('variant','Small',150000,4,4,true),('variant','Large',200000,1,0,true),('variant','Old',100,5,0,false);`);
    const v = (await search({ q: 'variant' })).items[0];
    assert.equal(v.price, 150000);
    assert.equal(v.price_from, true);
    assert.equal(v.in_stock, true);
    await db.exec(
      `INSERT INTO iam.listings(id,store_id,seller_id,category_id,title,slug,status,base_price_minor) SELECT 'fixture-'||n,CASE WHEN n%2=0 THEN 's1' ELSE 's2' END,'seller','laptops','Fixture device '||n,'fixture-'||n,'PUBLISHED',n*1000 FROM generate_series(1,60) n;`,
    );
    const a = await search({
        q: 'fixture',
        city: 'douala',
        limit: 10,
        sort: 'price_asc',
      }),
      b = await search({
        q: 'fixture',
        city: 'douala',
        page: 2,
        limit: 10,
        sort: 'price_asc',
      });
    assert.equal(a.total, 30);
    assert.equal(new Set([...a.items, ...b.items].map((i) => i.id)).size, 20);
    assert.equal(
      (await search({ q: 'fixture', limit: 8 }, true)).items.length,
      8,
    );
    await db.exec("UPDATE iam.stores SET status='SUSPENDED' WHERE id='s1'");
    assert.equal((await search({ q: 'latitude' })).total, 0);
    await db.exec('GRANT USAGE ON SCHEMA iam TO anon; SET ROLE anon;');
    await assert.rejects(search({ q: 'pc' }), /permission denied/);
    await db.exec('RESET ROLE;');
    console.log(
      'PASS database: real migrations, visibility, bilingual/typo search, prices, stock, expiry, pagination and permissions',
    );
  } finally {
    await db.close();
  }
};
