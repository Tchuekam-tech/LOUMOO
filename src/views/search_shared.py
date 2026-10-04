"""Accessible shared search surfaces."""
def get_search_suggestions():
    return """
<sc-if value="{{ searchOpen }}"><div id="search-suggestions" class="search-suggestions" role="listbox" aria-label="Search suggestions">
<sc-for list="{{ searchSuggestions }}" as="suggestion"><button type="button" role="option" tabindex="-1" id="{{ suggestion.optionId }}" aria-selected="{{ suggestion.selected }}" class="{{ suggestion.className }}" onClick="{{ () => selectSuggestion(suggestion) }}"><span>{{ suggestion.label }}</span><small>{{ suggestion.type }}</small></button></sc-for>
</div></sc-if>
"""

def get_search_cards(list_name='searchResultCards'):
    return """
<div class="search-cards"><sc-for list="{{ LIST }}" as="result">
<button class="search-card" onClick="{{ () => openSearchItem(result) }}" type="button">
<sc-if value="{{ result.image }}"><img src="{{ result.image }}" alt="" loading="lazy" decoding="async"></sc-if>
<span class="search-card-body"><small>{{ result.entityType }} · {{ result.verifiedLabel }}</small><strong>{{ result.title }}</strong><span>{{ result.storeLabel }}</span><b>{{ result.priceLabel }}</b><small>{{ result.ratingLabel }} {{ result.stockLabel }}</small></span>
</button></sc-for></div>
""".replace('LIST',list_name)

def get_combi_view(voice=False):
    controls = """
<p>Your voice is sent to ElevenLabs for this conversation. Sessions end after five minutes or when you leave. French and English welcome.</p>
<div class="search-actions"><sc-if value="{{ !combiVoiceActive }}"><button class="btn btn-primary" onClick="{{ startCombiVoice }}">Start voice conversation</button></sc-if><sc-if value="{{ combiVoiceActive }}"><button class="btn btn-secondary" onClick="{{ stopCombiVoice }}">End conversation</button></sc-if><span role="status">{{ combiVoiceStatus }}</span></div>
""" if voice else """
<p>Tell Combi what you need, your budget and your city. It can ask follow-up questions and search the public catalog.</p>
<sc-if value="{{ combiVoiceActive }}"><button class="btn btn-secondary" onClick="{{ stopCombiVoice }}">End conversation</button></sc-if>
"""
    return """
<section class="search-panel" aria-label="LOUMOO Combi"><div class="search-actions"><button class="btn btn-secondary" onClick="{{ back }}">Back</button><h2>LOUMOO Combi</h2></div>
""" + controls + """
<sc-if value="{{ !combiHasMessages }}"><p>Try “Un ordinateur à moins de 300 000 XAF à Douala” or “Help me find a hotel in Kribi”.</p></sc-if>
<div class="combi-transcript" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"><sc-for list="{{ combiMessages }}" as="message"><div class="combi-message"><strong>{{ message.role }}</strong><p>{{ message.text }}</p></div></sc-for></div>
<div class="search-actions"><label class="search-grow">Message Combi<input class="input" value="{{ combiInput }}" maxlength="1500" onInput="{{ setCombiInput }}" onKeyDown="{{ combiKey }}" placeholder="Ask a question or refine your search…" autocomplete="off"></label><button class="btn btn-primary" disabled="{{ combiBusy }}" onClick="{{ sendCombi }}">Send</button></div>
<sc-if value="{{ combiBusy }}"><p role="status">Connecting to Combi…</p></sc-if><sc-if value="{{ combiError }}"><p role="alert" class="search-error">{{ combiError }}</p></sc-if><sc-if value="{{ combiVoiceError }}"><p role="alert" class="search-error">{{ combiVoiceError }}</p></sc-if>
<sc-if value="{{ !isLoggedIn }}"><button class="btn btn-secondary" onClick="{{ on.signIn }}">Sign in to use Combi</button></sc-if><button class="btn btn-secondary" onClick="{{ on.search }}">Search by typing</button>
<sc-if value="{{ combiHasCards }}"><h3>From the LOUMOO catalog</h3><p>Check the listing for current details before ordering.</p>
""" + get_search_cards('combiCards') + """</sc-if></section>"""
