// answers.js - 3.9 (Josh, Oct-26, from his iPhone): what kind of message Juli got and how she answers it, in code (no model):
//   - a question about using p0pc0rn, or about Juli herself, is answered by Juli directly: no tool, no lookup, no Bigger brain
//     (helpAsk / selfAsk; HELP_NOTE + the FAQ's "How to ask Juli" section). "How do I ask you to make me an image?" had gone to the
//     Bigger brain with 3 tools, and the page ended.
//   - Juli herself is never looked up (cleanTopics; selfPicture): "Make me an image of you Juli" had asked which "Juli" on Wikipedia was
//     meant. A picture of her is an original self-portrait concept (SELF_PIC_NOTE): she has no fixed look.
//   - an everyday question that the looked-up facts answer gets a plain answer (ANSWER_NOTE), never a refusal: "Can dogs eat grapes?"
//     found 4 Wikipedia quotes and still got "I cannot provide specific dietary advice ... Settings > Rights & Copyright explains this".
//     A reply that refuses such a question anyway is asked again once (NUDGE); still a refusal: the facts' own words (factsAnswer).
//     Never for a request that could hurt someone (dangerAsk) or one the safety screen holds.
//   - the Rights & Copyright pointer belongs to a refusal for copyright, trademark or likeness only (stripPointer).
// A general how-to ("how do I boil an egg") and a joke stay quick chat on Juli's own model (howToAsk, jokeAsk).
// Round 4 (the phone-farm board, Oct-27):
//   - a how-to ("how do i remove a red wine stain", "tie a bowline knot") is answered with steps from what she knows (HOWTO_NOTE):
//     nothing is looked up (the farm looked up "Port-wine stain") and nothing is made ("I can't create video tutorials")
//   - a question whether something is safe to eat, drink, give or use (safetyAsk) that nothing looked up answers (safetyCovered) is
//     answered cautiously (safetyNote), never "safe": a reply that says it is safe anyway, or refuses, becomes cautionLine ("is avocardo
//     safe for cats": "Avocados are generally considered safe for cats", the farm's one unsafe answer)
//   - numbers, dates and names come from the looked-up facts; when they do not give the one asked for she says she is not sure and offers
//     to look further (ANSWER_NOTE, ANSWER_NOTE_OWN): "Germany borders six countries", "Spider-Man was created by Marvel Comics"
//   - a "Yes:" that opens the answer to a question that is not a yes-or-no one goes (stripYes: "what is the bigger brain" -> "Yes: ...")
const LEAD = String.raw`^\s*(?:(?:so|ok|okay|and|but|hey|hi|hello|please|um|well|juli)[,!.\s]+)*`;
const rx = (body, flags = 'i') => new RegExp(LEAD + body, flags);
const APP_NOUN = /\b(?:p0pc0rn|popcorn app|this app|the app|juli|you|u|pictures?|images?|photos?|pics?|selfies?|drawings?|paintings?|clips?|videos?|animations?|songs?|music|music videos?|lyrics|apps?|games?|wallpapers?|library|chats?|conversations?|settings|downloads?|models?|bigger brain|faster replies|playlists?|home ?screen|icons?|dock|skills?|routines?|about me|queue|create|cast|voices?)\b/i;
const APP_VERB = /\b(?:make|making|create|creating|draw|drawing|edit|editing|animate|animating|turn|get|save|saving|download|share|delete|remove|change|use|using|open|find|play|add|start|set|switch|stop|cancel|redo|undo|export|import|ask|tell|pin|move|rename|keep|see|view|listen|hear|update|install|clear|reset|write)\b/i;
const HOW = rx(String.raw`(?:how (?:do|can|could|should|would|will|does) (?:i|we|you|u|one|someone|people)|how to|what(?:'s| is) the (?:best |easiest |right |quickest |fastest )?way to|is there a (?:way|setting) to|where (?:do|can|should|did|does) (?:i|we|my|you)|where (?:is|are) (?:the |my |your )?|what (?:do|should) i (?:say|type|write|ask|tap|press|do|use)|which (?:words|prompt|button|setting))\b`);
const CAN = rx(String.raw`(?:can|could|do|will|would) (?:you|u|juli) (?:make|do|create|draw|write|sing|generate|edit|animate|look (?:things |stuff )?up|search|play|remember|see|read|speak|talk|help(?: me)?|show|change|fix|translate|code)\b(?:\s+(?:me\s+)?(?:any|some|other)?\s*(?:videos?|songs?|music|pictures?|images?|photos?|drawings?|apps?|games?|things|facts|stuff|anything|that|this|it|lyrics|poems?|stories|art|animations?|clips?|me))?\s*[?.!]*\s*$`);
const WHAT_CAN = rx(String.raw`what (?:else )?(?:can|could|do|are|is) (?:you|u|juli)(?: able to| good at)? (?:do|make|create|help with|offer)\b`);
const WHY_CANT = rx(String.raw`why (?:can'?t|cannot|won'?t|don'?t|didn'?t|wouldn'?t|isn'?t|aren'?t) (?:you|u|juli|it|p0pc0rn|the app)\b`);
const WHAT_IS_APP = rx(String.raw`what(?:'s| is| are| does)? (?:the |a |an |my )?(?:bigger brain|faster replies|library|chats|skills?|routines?|about me|create|connection|dock|p0pc0rn|popcorn app|this app|the queue|cast|benchmark|device check|home screen|wallpaper)\b`);
const HOW_LONG = rx(String.raw`how (?:long|much time|many minutes) (?:do|does|will|would|can) (?:a |an |the |my |your )?(?:songs?|pictures?|images?|clips?|videos?|music videos?|downloads?|apps?|it)\b`);
/** a question about using p0pc0rn (how to make, edit, find, change things; what Juli can do; why she can't) */
export function helpAsk(text) {
  const t = String(text || '').trim(); if (!t || t.length > 240) return false;
  if (WHAT_CAN.test(t) || WHY_CANT.test(t) || WHAT_IS_APP.test(t) || HOW_LONG.test(t) || CAN.test(t)) return true;
  if (!HOW.test(t)) return false;
  const rest = t.replace(HOW, ' ');
  return APP_NOUN.test(rest) && (APP_VERB.test(rest) || /^(?:where|which)\b/.test(lead(t)));
}
const SELF = [/^(?:who|what) (?:are|r) (?:you|u)\b/, /^(?:who|what) is juli\b/, /^tell me (?:more )?about (?:yourself|you)\b/,
  /^(?:who|what company|which company) (?:made|built|created|designed|trained|programmed|owns) (?:you|u|juli)\b/,
  /^what(?:'s| is) your (?:name|purpose|job|favou?rite|age|model|look)\b/, /^what does (?:your name|juli) mean\b/,
  /^(?:are|r) (?:you|u) (?:a |an )?(?:robot|ai|human|person|real|alive|bot|machine|computer|program|girl|boy|woman|man|chatbot|assistant)\b/,
  /^(?:do|can) (?:you|u) (?:have|feel|think|dream|sleep|eat|remember|love|like|get tired|get bored)\b/,
  /^what do (?:you|u) look like\b/, /^how old (?:are|r) (?:you|u)\b/, /^where (?:are|do) (?:you|u) (?:from|live|run)\b/, /^how (?:are|r) (?:you|u) (?:made|built|trained|different)\b/,
  /^what (?:model|ai|llm|language model) (?:are|r) (?:you|u)\b/];
const lead = (t) => String(t || '').toLowerCase().replace(new RegExp(LEAD, 'i'), '').replace(/[’]/g, "'").trim();
/** a question about Juli herself (who she is, what she looks like, who made her): answered from what p0pc0rn knows, never looked up */
export function selfAsk(text) { const t = lead(text); return t.length <= 200 && SELF.some((r) => r.test(t)); }
const SELF_PIC = /\b(?:picture|image|photo|pic|portrait|selfie|drawing|painting|sketch|avatar|illustration|clip|video|animation|cartoon)s?\s+of\s+(?:you|u|yourself|juli)\b|\b(?:draw|paint|sketch|show|make|create|generate|render)\s+(?:me\s+)?(?:a\s+(?:picture|image|portrait|drawing|selfie)\s+of\s+)?(?:you|u|yourself|juli)\b(?!\s+(?:a|an|the|some|my|me)\b)|\bself[- ]?portrait\b|\bwhat (?:you|u) (?:look|would look) like\b/i;
/** a picture (or clip) of Juli herself */
export function selfPicture(text) { return SELF_PIC.test(String(text || '')); }
const HOWTO = rx(String.raw`(?:how (?:do|can|could|should|would) (?:i|we|you|u|one)|how to|what(?:'s| is) (?:a |the )?(?:good|best|right|easiest|quickest) way to|any tips (?:for|on)|tips (?:for|on))\b`);
/** a general how-to question ("how do I boil an egg", "how do I write a cover letter"): advice in words, not a piece to write */
export function howToAsk(text) { const t = String(text || ''); return t.length <= 240 && HOWTO.test(t); }
const TASK = rx(String.raw`(?:tie|untie|change|replace|remove|clean|wash|fix|repair|unclog|unblock|keep|grow|plant|water|boil|cook|bake|fry|roast|grill|brew|sharpen|stop|treat|prevent|get rid of|jump[- ]?start|charge|reset|install|set up|cure|relieve|soothe|learn|study|pack|fold|iron|sew|knit|peel|chop|store|freeze|thaw|defrost|season|make)\b`);
/** a terse everyday task, said as an order ("tie a bowline knot", "change flat tire", "make homemade pasta"): a how-to question, never a
 *  picture, clip or song (round 2 offered every tool: "I can't physically tie a knot for you, but I can create a picture ...") */
export function taskAsk(text) { const t = String(text || '').trim(); return t.length <= 160 && t.split(/\s+/).length >= 2 && TASK.test(t) && !MAKE_NOUN.test(t) && !/\b(?:it|this|that|them|again|another)\b/i.test(t); }
const JOKE = rx(String.raw`(?:tell|give) (?:me |us )?(?:a |one |another |a quick |a short |a funny |some )?(?:joke|riddle|pun|fun fact)s?\b`);
/** a joke, a riddle or a fun fact: quick chat */
export function jokeAsk(text) { return JOKE.test(String(text || '')); }
const DANGER = /\b(?:kill(?:s|ing|ed)?|murder\w*|suicid\w*|overdos\w*|lethal|fatal|deadly dose|poison(?:ing)? (?:someone|somebody|a person|people|him|her|my|them)|bombs?|explosives?|molotov|detonat\w*|weapons?|guns?|firearms?|ammo|ammunition|meth|cocaine|heroin|fentanyl|lsd|hack(?:ing|ed|er)?|steal(?:ing)?|stalk(?:ing)?|spy(?:ing)? on|track (?:my|someone|her|him|their|a person)|break into|ddos|malware|ransomware|phishing|self[- ]?harm|hurt (?:myself|someone|somebody|people)|cut myself|abuse|nudes?|naked|porn\w*|sex\w*)\b/i;
/** could an answer help someone hurt people (or is it sexual)? Then Juli is never pushed to answer it */
export function dangerAsk(text) { return DANGER.test(String(text || '')); }
/** topics the lookup planner gave, without Juli herself and the app (they are never looked up) */
export function cleanTopics(topics) {
  return (topics || []).filter((tp) => !/^(?:juli|you|yourself|me|myself|p0pc0rn|popcorn|popcorn app|the assistant|assistant|this app|the app|juli \((?:assistant|ai|app|p0pc0rn|chatbot)\)|juli (?:ai|assistant))$/i.test(String((tp && tp.topic) || '').replace(/^["'“”]+|["'“”]+$/g, '').trim()));
}

const REFUSE = new RegExp(String.raw`\bi\s*(?:can'?t|cannot|can not|am not able to|'m not able to|am unable to|'m unable to|won'?t|will not|must decline|have to decline|'m not allowed to|am not allowed to|do not|don'?t)\s+(?:provide|give|offer|help|assist|answer|share|recommend|discuss|advise|support|comply|fulfill|fulfil|tell you|explain)`
  + String.raw`|\b(?:sorry|apologi[sz]e)\b[^.!?]{0,60}\b(?:can'?t|cannot|unable|not able)\b|\bi'?m (?:sorry|afraid)\b[^.!?]{0,40}\b(?:can'?t|cannot)\b|\bnot (?:able|qualified|allowed) to (?:give|provide|offer) (?:medical|dietary|veterinary|legal|health|professional)\b`, 'i');
const DEFER = /\b(?:consult|ask|talk to|speak (?:to|with)|contact|see|check with)\s+(?:a|an|your|the)\s+(?:local\s+)?(?:veterinarian|vet|doctor|physician|pharmacist|professional|expert|healthcare provider|health care provider|medical professional|dietitian|specialist)\b/i;
/** a reply that refuses ("I cannot provide ...") or opens by deferring ("It is best to consult a vet ...") instead of answering; judged
 *  on its first sentences (a caveat after the answer is fine) */
export function refusalLike(reply) {
  const s = String(reply || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim(), parts = s.split(/(?<=[.!?])\s+/);
  let head = ''; for (const p of parts) { if (head.length >= 160) break; head += (head ? ' ' : '') + p; }
  return REFUSE.test(head.slice(0, 260)) || DEFER.test(parts[0] || '');
}
const RIGHTS_ASK = /\b(?:copyright|trademark|likeness|celebrit\w*|famous (?:people|person|characters?)|real (?:people|person)|consent|rights)\b/i;
/** the Rights & Copyright pointer out of a reply that is not about copyright, trademarks or likeness (the whole reply if nothing else is left) */
export function stripPointer(reply, ask = '') {
  const s = String(reply || '');
  if (RIGHTS_ASK.test(String(ask || '')) || !/rights\s*(?:&|and)\s*copyright/i.test(s)) return s;
  const out = s.replace(/[^.!?\n]*\brights\s*(?:&|and)\s*copyright\b[^.!?\n]*[.!?]?/gi, '').replace(/[ \t]+([.,!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out || s;
}
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'about', 'that', 'this', 'what', 'which', 'who', 'how', 'why', 'when', 'where', 'does', 'did',
  'are', 'was', 'were', 'can', 'could', 'should', 'would', 'will', 'may', 'might', 'has', 'have', 'had', 'you', 'your', 'our', 'eat', 'get', 'its', 'any', 'some']);
const words = (s) => new Set((String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 3 && !STOP.has(w))
  .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));
/** round 4: an article about what was asked: two of its title's words (all of a shorter title) are in the question */
function aboutAsk(title, ask) { const tw = words(title), aw = words(ask); return [...tw].filter((w) => aw.has(w)).length >= Math.min(2, tw.size); }
/** the facts' own words, when Juli still would not answer: "According to Wikipedia: “...” “...”" (quotes only: never a new claim);
 *  round 4: only from an article about what was asked, never for a how-to */
export function factsAnswer(research, ask = '') {
  if (ask && (howToAsk(ask) || taskAsk(ask))) return '';
  const r = (research || []).find((x) => x && x.status === 'hit' && (x.facts || []).some((f) => f.quote || f.value) && (!ask || aboutAsk(x.title, ask)));
  if (!r) return '';
  const qs = r.facts.map((f) => String(f.quote || f.value || '').trim()).filter(Boolean).slice(0, 2);
  const site = String((r.source && r.source.siteName) || 'Wikipedia').replace(/\s*\(Fandom\)$/, '');
  return `Here is what ${site} says about “${r.title}”: ` + qs.map((q) => `“${q.replace(/^“|”$/g, '')}”`).join(' ');
}

/** the tools that make something (a plan that offers one of them is not a plain question) */
export const MAKE_TOOLS = new Set(['make_picture', 'edit_picture', 'make_clip', 'animate_picture', 'clip_between', 'add_sound', 'make_song', 'make_music_video']);
export const HELP_NOTE = 'The person asks how to use p0pc0rn, or about you. Answer only what they asked, in two to four short sentences, from the notes below that match it: the answer first (yes or no first only when they ask whether you can), then how. When it is about making something, give one example request in quotes that they can copy. Do not make anything, do not look anything up, do not call a tool and do not name tools.';
export const HELP_IDS = ['faq#how-to-ask-juli'];
/** the notes' room in a how-to prompt (it offers no tools): an FAQ section that matches the words (the Bigger brain's, 454 tokens) goes
 *  first, then the how-to section (551) */
export const HELP_NOTES = 1400;
export const SELF_PIC_NOTE = 'The person asks for a picture of you, Juli. You have no body and no fixed look, so invent an ORIGINAL look for yourself: a friendly, creative character of your own design (never a real person and never a known character), in the setting and style they asked for. Describe only the look: leave your name out of the prompt (the picture model would try to letter it). Make it with the picture tool; there is nothing to look up.';
export const ANSWER_NOTE = 'The person asked an everyday question; the research results below are what was looked up for it. Answer it plainly in two to four short sentences, with the answer first (for example "No: grapes are toxic to dogs..."). Take every number, date and name from the results: when they do not give the one that was asked for, say you are not sure of it and offer to look further, rather than giving one from memory. When asked how many, name each one the results list, then give the count. Questions about food, pets, health, safety, home or travel are fine to answer: give the facts, then one short practical caveat only if it matters (for example "If your dog ate some, call a vet now"), never a general "consult a vet or doctor" line. When you are not sure a food or plant is safe for a pet or a child, say it is best avoided. Never talk about the results themselves, do not refuse, do not say you cannot give advice, and do not mention Settings.';
export const ANSWER_NOTE_OWN = 'The person asked an everyday question and nothing was found for it. Answer it in one to three short sentences, the answer first, with only what you are sure of: give no number, date or name from memory, and when the answer needs one, say you are not sure and offer to look it up. Questions about food, pets, health, safety, home or travel are fine to answer, with one short practical caveat only if it matters, never a general "consult a vet or doctor" line. When you are not sure a food or plant is safe for a pet or a child, say it is best avoided. Do not refuse, do not say you cannot give advice, and do not mention Settings.';
/** round 4: a question whether something is safe, when nothing looked up says whether it is: the cautious answer itself, in her words
 *  (the desk round: a note that described it was copied as "You could not confirm ... Who can say for sure (a vet for a pet, ...)") */
export function safetyNote(text) {
  return 'The person asks whether something is safe to eat, drink, give or use, and nothing that was looked up says whether it is. Never say it is safe, fine or okay. Reply with: "'
    + cautionLine(text) + '" You may add one short sentence about a well-known risk, only if you are sure of it. Do not refuse and do not mention Settings.';
}
/** round 4: a how-to: steps from what she knows, nothing looked up or made */
/** round 4: the how-to note for this message: a terse order is read as the question it is ("keep basil alive" -> "How do I keep basil
 *  alive?"; the desk round asked back "What kind of basil are you referring to?") */
export function howToNote(text) {
  const t = String(text || '').trim().replace(/[.?!]+$/, '');
  return HOWTO_NOTE + (taskAsk(t) && !howToAsk(t) ? ` They mean: "How do I ${t.charAt(0).toLowerCase() + t.slice(1)}?"` : '');
}
export const HOWTO_NOTE = 'The person asks how to do something. Answer with the steps in a short numbered list (three to six steps), then one short safety tip only if it matters. Answer from what you know: nothing needs to be looked up or made. Never say you cannot show, make or do it.';
const PETS = String.raw`(?:dogs?|pupp(?:y|ies)|cats?|kittens?|rabbits?|bunn(?:y|ies)|hamsters?|guinea pigs?|gerbils?|rats?|mice|ferrets?|birds?|parrots?|budgies?|chickens?|ducks?|horses?|ponies|pony|goats?|pigs?|cows?|sheep|tortoises?|turtles?|lizards?|snakes?|fish|pets?)`;
const KIDS = String.raw`(?:bab(?:y|ies)|toddlers?|infants?|kids?|children|child|pregnant (?:women|people))`;
const SAFETY_Q = new RegExp(String.raw`\bcan (?:my |a |an |our |your |the )?(?:${PETS}|${KIDS}) (?:safely |still )?(?:eat|have|drink|take|chew|lick)\b`
  + String.raw`|\bcan (?:i|we|you|u|people|humans?) (?:safely )?(?:eat|drink|take)\b`
  + String.raw`|\b(?:is|are|isn'?t|aren'?t)\b[^?.!]{0,60}?\b(?:safe|ok|okay|fine|bad|toxic|poisonous|harmful|dangerous)\s+(?:for|to)\b`
  + String.raw`|\b(?:safe|ok|okay) to (?:eat|drink|take|give|feed|use|mix)\b|\b(?:can|should|could) (?:i|we|you) (?:give|feed)\b`
  + String.raw`|\b(?:toxic|poisonous|harmful)\s+(?:for|to)\s+(?:my |a |an |our |your )?(?:${PETS}|${KIDS})\b`, 'i');
/** round 4: does the person ask whether something is safe to eat, drink, give or use? (never a request that could hurt someone) */
export function safetyAsk(text) { const t = String(text || ''); return t.length <= 240 && SAFETY_Q.test(t) && !dangerAsk(t); }
const SAFE_WORDS = /\b(?:toxic\w*|toxin\w*|poison\w*|safe(?:ly|ty)?|unsafe|harm\w*|hazard\w*|danger\w*|fatal|lethal|deadly|kidney|liver|vomit\w*|diarrh\w*|seizures?|illness\w*|sick\w*|risks?|salmonella|e\. ?coli|bacteri\w*|xylitol|persin|theobromine|allerg\w*|chok\w*|avoid\w*|should not|must not)\b/i;
/** round 4: does something that was looked up say whether it is safe (toxic, harmful, a risk, safe ...)? */
export function safetyCovered(research) {
  return (research || []).some((r) => r && r.status === 'hit' && (r.facts || []).some((f) => SAFE_WORDS.test(String(f.quote || f.value || ''))));
}
const WHO_RE = new RegExp(String.raw`^(?:${PETS}|${KIDS}|humans?|people|person)$`, 'i');
const THING = [new RegExp(String.raw`\bcan (?:my |a |an |our |your |the )?(?:${PETS}|${KIDS}) (?:safely |still )?(?:eat|have|drink|take|chew|lick) (?:a |an |some |the )?([a-z][a-z' -]{1,40}?)\s*[?.!]*$`, 'i'),
  /\bis (?:it )?(?:safe|ok|okay) (?:for \w+ )?to (?:eat|drink|take|give|feed|use) (?:a |an |some |the )?([a-z][a-z' -]{1,40}?)\s*[?.!]*$/i,
  /\b(?:is|are) ([a-z][a-z' -]{1,40}?) (?:safe|ok|okay|bad|toxic|poisonous|harmful|dangerous) (?:for|to)\b/i];
/** round 4: one more lookup for a safety question whose facts say nothing about safety: "<the thing> toxicity" ("Avocado toxicity" finds
 *  "Persin", the toxin of avocados; "Chocolate toxicity" redirects to "Theobromine poisoning"); '' when there is no thing to name */
export function safetyTopic(text, research = []) {
  let thing = (research || []).map((r) => String((r && (r.topic || r.title)) || '').trim()).find((t) => t && !WHO_RE.test(t) && !/\b(?:toxicity|toxic|poisoning)\b/i.test(t)) || '';
  if (!thing) { const m = THING.map((r) => r.exec(String(text || ''))).find(Boolean); thing = m ? m[1].trim() : ''; }
  thing = thing.replace(/^(?:raw|cooked|fresh|dried|ripe)\s+/i, '').trim();
  return thing && !WHO_RE.test(thing) ? (thing.charAt(0).toUpperCase() + thing.slice(1)).slice(0, 60) + ' toxicity' : '';
}
/** round 4: the toxicity lookup's hit is used only when it says whether it is safe AND names the thing ("Persin ... present in the
 *  avocado" for "Avocado toxicity"; never "Cohoba", a snuff, for "Cookie dough toxicity") */
const hasAll = (tw, s) => { const w = words(s); return tw.size > 0 && [...tw].every((x) => w.has(x)); };
export function safetyFound(r, topic) {
  if (!r || r.status !== 'hit' || !safetyCovered([r])) return false;
  // its title names the thing, or one quote names the thing AND says whether it is safe ("When persin is consumed by domestic animals
  // through ... the avocado tree ..., it is toxic and dangerous"); the desk round: "Manchineel" named apples only in its name's origin
  const tw = words(String(topic || '').replace(/\btoxicity\b/i, ''));
  return hasAll(tw, r.title) || (r.facts || []).some((f) => { const q = String(f.quote || f.value || ''); return SAFE_WORDS.test(q) && hasAll(tw, q); });
}
const HARM = /\b(?:toxic|dangerous|fatal|lethal|deadly|poisonous|harmful|poisoning)\b/i, HARM_ANY = /\b(?:toxic\w*|toxin\w*|poison\w*|danger\w*|fatal|lethal|deadly|harmful|kidney (?:failure|injury)|liver (?:failure|damage))\b/i;
/** round 4: a safety question whose looked-up facts say it is harmful, answered "safe" anyway (the desk round: "Avocados can be safe for
 *  cats in moderation" from Persin's "toxic and dangerous" to domestic animals): the facts' own words instead; '' when none say so */
export function harmLine(text, research) {
  // only words about THE THING: a quote from an article whose title names it, or a quote that names it itself
  const tw = words(String(safetyTopic(text, research) || '').replace(/\btoxicity\b/i, ''));
  const quotes = (research || []).filter((x) => x && x.status === 'hit').flatMap((x) => (x.facts || []).map((f) => ({ x, q: String(f.quote || f.value || '').trim() })))
    .filter((o) => hasAll(tw, o.x.title) || hasAll(tw, o.q));
  const hit = quotes.find((o) => HARM.test(o.q)) || quotes.find((o) => HARM_ANY.test(o.q));
  if (!hit) return '';
  const a = new RegExp(String.raw`\b${PETS}\b`, 'i').exec(String(text || '')), w = a ? a[0].toLowerCase() : '', pet = w ? ONE[w] || (w.endsWith('s') ? w.slice(0, -1) : w) : '';
  const site = String((hit.x.source && hit.x.source.siteName) || 'Wikipedia').replace(/\s*\(Fandom\)$/, '');
  return `It's best not to${pet ? ` give it to your ${pet}` : ''}: ${site} says “${hit.q.replace(/[.\s]+$/, '')}.”${pet ? ` If your ${pet} ate some, call a vet.` : ''}`;
}
const SAFE_CLAIM = /\b(?:is|are|'s|'re)\s+(?:generally\s+|usually\s+|typically\s+|perfectly\s+|completely\s+|totally\s+|mostly\s+|often\s+)?(?:considered\s+|thought to be\s+)?(?:safe|fine|okay|ok|harmless|non-?toxic)\b|\b(?:can|may)\s+(?:generally\s+|safely\s+|usually\s+|typically\s+|often\s+)?(?:eat|have|drink|take)\b|\b(?:can|may|could|should|would)\s+be\s+(?:generally\s+|perfectly\s+|quite\s+)?(?:safe|fine|okay|ok|harmless)\b/gi;   // round 4: + "can be safe"
/** round 4: does a reply say that it is safe ("are generally considered safe", "can eat")? A "not" just before it does not count */
export function assertsSafe(reply) {
  const s = String(reply || '').replace(/[’]/g, "'");
  for (const m of s.matchAll(SAFE_CLAIM)) if (!/\b(?:not|never|no)\b[^.!?]{0,20}$/i.test(s.slice(Math.max(0, m.index - 24), m.index))) return true;
  return false;
}
const MEDICINE = /\b(?:medicines?|medications?|pills?|tablets?|capsules?|drugs?|ibuprofen|paracetamol|acetaminophen|aspirin|tylenol|advil|motrin|aleve|naproxen|antibiotics?|antihistamines?|supplements?|vitamins?|melatonin|cough syrup|doses?)\b/i;
const ONE = { puppies: 'puppy', bunnies: 'bunny', mice: 'mouse', ponies: 'pony', fish: 'fish', sheep: 'sheep' };
/** round 4: the cautious answer, when nothing looked up says it is safe */
export function cautionLine(text) {
  const t = String(text || ''), a = new RegExp(String.raw`\b${PETS}\b`, 'i').exec(t);
  if (a) { const w = a[0].toLowerCase(), pet = ONE[w] || (w.endsWith('s') ? w.slice(0, -1) : w); return `I couldn't find a source that says it's safe, so it's best not to give it to your ${pet} until a vet says it's OK.`; }
  if (MEDICINE.test(t)) return "I couldn't confirm that it's safe, so check with a pharmacist or a doctor before taking it.";
  if (new RegExp(String.raw`\b${KIDS}\b`, 'i').test(t)) return "I couldn't confirm that it's safe, so it's best avoided until a doctor says it's OK.";
  return "I couldn't confirm that it's safe, so it's best avoided for now.";
}
const YES_NO = /^(?:can|could|do|does|did|is|are|was|were|will|would|should|shall|may|might|has|have|had|am|isn'?t|aren'?t|don'?t|doesn'?t|didn'?t|won'?t|can'?t|wouldn'?t|shouldn'?t)\b/;
/** round 4: a yes-or-no question ("can you make videos", "is it safe ...") */
export function yesNoAsk(text) { return YES_NO.test(lead(text)); }
/** round 4: a "Yes:" / "No," that opens the answer to a question that is not a yes-or-no one ("what is the bigger brain" -> "Yes: The ...") */
export function stripYes(reply, ask = '') {
  const s = String(reply || ''); if (!ask || yesNoAsk(ask)) return s;
  const m = /^\s*(?:yes|no)\s*[:,!.–—-]\s*/i.exec(s); if (!m || m[0].length >= s.length) return s;
  const rest = s.slice(m[0].length); return rest.charAt(0).toUpperCase() + rest.slice(1);
}
export const NUDGE = 'That is an everyday question you can answer. Answer it now in two to four plain sentences, from the research results above where they cover it, else from what you know (never talk about the results themselves): the answer first, then one short practical caveat only if it matters. Do not refuse, do not only tell the person to ask someone else, and do not mention Settings.';
/** this reply refuses a question Juli should answer: ask her once more (never for a request that could hurt someone) */
export function shouldNudge(ask, reply, { offeredRender = false, refused = 0, held = false } = {}) {
  return (!offeredRender || plainQuestion(ask)) && !refused && !held && !dangerAsk(ask) && refusalLike(reply);
}
const QUESTION = /^\s*(?:what|who|whom|whose|when|where|why|how|which|is|are|was|were|does|do|did|tell me|explain|can|could|should|would|will|may|might|has|have|had)\b/i;
const MAKE_NOUN = /\b(?:pictures?|photos?|images?|pics?|drawings?|paintings?|portraits?|posters?|wallpapers?|clips?|videos?|movies?|animations?|songs?|tracks?|tunes?|ballads?|lullab(?:y|ies)|anthems?|jingles?|hymns?|shant(?:y|ies)|raps?|music|lyrics|sketch(?:es)?|logos?|selfies?)\b/i;   // round 4: + the song words ("make a lullaby for my baby")
/** a question that asks for no picture, clip or song ("does sugar make kids hyper?": its "make" offered every tool): a refusal of it is
 *  asked again even where the plan offered tools to make things (the model made nothing, it only refused) */
export function plainQuestion(text) { const t = String(text || ''); return QUESTION.test(t) && !MAKE_NOUN.test(t); }
