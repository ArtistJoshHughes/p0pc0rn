// rights.js - p0pc0rn's copyright / trademark / likeness lesson, the agreement record, the per-upload attestation and the
// Settings > Rights & Copyright reference. ONLY source: Josh's research hand-off "Copyright & IP Policy Research: AI Media
// Generation App" (Oct 12, 2026). Card copy drafted by the local Qwen, checked line by line against that document. No case, statute,
// date or number appears here that the document does not contain. General information, not legal advice.
// The agreement and the upload log stay on this phone (localStorage); nothing here is ever sent anywhere.

export const TERMS_VERSION = '2026-10-14.2';          // the engines check the same string: a new version = the lesson again (v026.4: the model rules, AI disclosure, Oregon; v026.5: lip-sync's Open RAIL-M)
export const CONSENT_KEY = 'p0pc0rn:consent';       // {terms, agreedAt, cards}: written ONLY by agree() after every card was seen
const UPLOADS_KEY = 'p0pc0rn:uploads';              // the last 50 upload attestations (time, file SHA-256, terms, exact text)
export const AS_OF = 'General information as of Oct 14, 2026, not legal advice.';

export const CARDS = [
  { tag: 'Copyright', title: 'What copyright protects', points: [
    'Only the owner of a work may reproduce it, make derivative works, and distribute, display and perform it (17 U.S.C. § 106).',
    "Uploading someone else's image or song to make a close variation touches the reproduction and derivative-work rights.",
    'Copyright protects human authorship. Purely AI-generated output is not copyrightable in the U.S.',
  ] },
  { tag: 'Fair use', title: 'Fair use and transformative use', points: [
    'Fair use (17 U.S.C. § 107) weighs four factors: purpose and character, nature of the work, amount used, and market effect.',
    'After Andy Warhol Foundation v. Goldsmith (2023), a new look or meaning is not enough when the new use serves the same commercial purpose as the original.',
    'Market harm, the fourth factor, is now the center of most AI disputes.',
    'Fair use is a defense argued after the fact, not a permission.',
  ] },
  { tag: 'Your own media', title: 'Start from your own media', points: [
    'When you start from a photo you own, you are the one who can authorize a close variation of it.',
    'A close variation of an uploaded image is a derivative work: lawful only if you own the input or hold a license covering AI transformation.',
    'Not all rights sit with the uploader. A photo can belong to the photographer, not the person pictured; a commissioned work may belong to the artist unless there is a written assignment.',
    'Owning the input does not make the AI-added parts of the output copyrightable.',
  ] },
  { tag: 'Faces and voices', title: "People's faces and voices", points: [
    'Faces and voices raise right-of-publicity issues separate from copyright. Several states protect likeness and voice, such as Tennessee’s ELVIS Act and California’s digital-replica statutes.',
    'Use a person’s face, body or voice only with their consent, or if it is you.',
    'The federal TAKE IT DOWN Act is law: publishing non-consensual intimate images, including AI deepfakes, is a federal crime. Making them is not allowed in p0pc0rn.',
    'The NO FAKES Act of 2026, a proposed federal voice-and-likeness right, is not yet law.',
  ] },
  { tag: 'Trademarks', title: 'Trademarks, brands and characters', points: [
    'Famous characters are the highest-risk output. Disney, Universal and Warner Bros. are suing Midjourney over them.',
    'Logos and watermarks that show up in outputs create trademark exposure. In Getty Images v. Stability AI (a UK case, not U.S. law), Getty won a narrow trademark claim over its watermarks.',
    'Logos and characters used as brands can bring trademark claims on top of copyright.',
    'Removing a watermark, signature or credit to hide infringement is a separate violation (17 U.S.C. § 1202).',
  ] },
  { tag: 'AI output', title: 'Who owns AI output', points: [
    'The Copyright Office’s January 2025 report found that prompts alone do not give you enough control to be the author of the output.',
    'Thaler v. Perlmutter: the Supreme Court declined to hear it on March 2, 2026, so fully autonomous AI output cannot be copyrighted.',
    'Allen v. Perlmutter: the Office refused to register a Midjourney image made with 624+ prompts plus Photoshop edits; only the human edits were registrable. Allen took it to court in Sept. 2024.',
    'Your own source art, edits, selection and arrangement can be protected. Keep records of them, and disclaim the AI-generated parts when you register.',
  ] },
  // v026.4 (terms 2026-10-14): from the model licences (Josh's licence audit, Oct 14 2026) and Josh's decisions, not from the research
  // document above: the models' use restrictions become enforceable terms, AI disclosure, consent for voices and lip-syncs, Oregon law.
  { tag: 'Model rules', title: 'Model rules, sharing and the law', points: [
    'The models come with their own rules, and you agree to them: the Gemma Prohibited Use Policy (the video model reads your words with Gemma) and the LTX-2 use restrictions in Attachment A (the video decoder). Among them: no sexually explicit content made for gratification, no harassment, no harmful false information, nothing that harms minors.',
    'No deepfakes, voice clones or lip-syncs of a person without their consent, or unless it is you. Lip-sync (experimental) also follows the CreativeML Open RAIL-M use restrictions: nothing unlawful, nothing that harms minors, no harmful false information, no harassment or defamation.',
    'When you share or publish something you made here, say that it is AI-generated. Saved and shared files carry the label “AI-generated with p0pc0rn”.',
    'You agree to follow the laws of the State of Oregon, and the laws where you are.',
  ], links: [['Gemma Prohibited Use Policy', 'licenses/GEMMA_PROHIBITED_USE_POLICY.txt'], ['LTX-2 licence with Attachment A', 'licenses/LICENSE-LTX-2.txt'], ['Lip-sync: CreativeML Open RAIL-M', 'licenses/LICENSE-CreativeML-OpenRAIL-M.txt'], ['The full use policy', 'USE-POLICY.md']] },
];
export const AGREE = 'I agree not to use p0pc0rn to break U.S. copyright or trademark law, and not to make non-consensual likeness or intimate imagery of anyone. I agree to the model rules (the Gemma Prohibited Use Policy, the LTX-2 use restrictions and, for lip-sync, the CreativeML Open RAIL-M use restrictions), to make no deepfake, voice clone or lip-sync of a person without their consent, to say that what I share is AI-generated, and to follow the laws of the State of Oregon and the laws where I am.';

// ---- the per-upload attestation: the document's checkbox text, verbatim (never pre-checked, required on every new upload)
export const ATTEST = 'I own the copyright in this file, or I have written permission from the owner to use it to create AI-generated derivative works, including close, non-transformative variations. Every identifiable person whose face, body or voice appears in it has given consent (or is me). I understand that uploading media I do not have rights to may make me personally liable under U.S. copyright law and other laws, as summarized below.';
// "What this means" (the document's panel; its "Platform consequences" item is left out: p0pc0rn has no server, accounts or hosting)
export const MEANS = [
  ['Civil liability.', 'A copyright owner can sue you for an injunction plus actual damages and profits, or statutory damages of $750–$30,000 per work, up to $150,000 per work for willful infringement, plus court costs and attorney’s fees (17 U.S.C. §§ 504–505).'],
  ['Criminal liability.', 'Willful infringement for commercial gain, or copies worth over $1,000 in 180 days, can be a federal crime (17 U.S.C. § 506).'],
  ['False statements.', 'Knowingly misrepresenting your rights in a DMCA counter-notice makes you liable for damages and fees (§ 512(f)).'],
  ['Likeness and intimate imagery.', 'Using someone’s face or voice without consent can violate state right-of-publicity laws. Publishing non-consensual intimate images, including AI deepfakes, is a federal crime under the TAKE IT DOWN Act. Making them is not allowed in p0pc0rn.'],
  ['No ownership of raw AI output.', 'AI-generated material without enough human creative control is generally not copyrightable in the U.S.'],
];

// ---- Settings > Rights & Copyright: what an artist can do (the document's order: document, register, notify, tribunal or court)
export const STEPS = [
  ['Document the misuse.', 'Save URLs, dated screenshots or screen recordings, the prompt or listing if visible, and proof you created the original (source files, layered PSDs, RAW photos, project files, stems, earlier posting dates).'],
  ['Register the work', 'at copyright.gov. Registration is required before a U.S. infringement suit (§ 411), and timely registration unlocks statutory damages and attorney’s fees (§ 412).'],
  ['Send a DMCA takedown notice', 'to the platform hosting the copy, through its designated agent (searchable in the Copyright Office DMCA directory). Under 17 U.S.C. § 512(c)(3), a valid notice includes:'],
  ['Send a cease-and-desist letter', 'to the person or company. Identify you and your work, describe the infringing use with evidence, state that it is unauthorized, demand specific actions (stop, remove, account for profits, confirm in writing) by a deadline, and reserve all rights. Keep it factual; avoid threats you would not carry out. Send it in a trackable way and keep copies. An ignored demand can later support a finding of willfulness.'],
  ['File with the Copyright Claims Board', 'for smaller disputes (ccb.gov). A voluntary, mostly online tribunal in the Copyright Office: total damages are capped at $30,000 per proceeding and $15,000 per work in statutory damages. Respondents can opt out, and you cannot bring the same claim in federal court afterward.'],
  ['Sue in federal court.', 'Remedies include an injunction, actual damages and profits, or statutory damages of $750–$30,000 per work, up to $150,000 per work if infringement was willful (17 U.S.C. § 504). The deadline is generally three years from when the claim accrued.'],
  ['Use related claims where they fit:', 'trademark (logos, characters used as brands), right of publicity (your face or voice), § 1202 (stripped watermarks or credits), and contract claims (breach of a license or a platform’s terms).'],
];
export const DMCA = ['your physical or electronic signature;', 'identification of the copyrighted work;', 'identification and location (URL) of the infringing material;',
  'your contact information;', 'a statement of good-faith belief the use is unauthorized;', 'a statement, under penalty of perjury, that the notice is accurate and you are the owner or authorized to act.'];
export const COUNTER = 'If you receive a takedown and believe it is wrong, you may file a counter-notice (§ 512(g)). Knowingly false notices or counter-notices create liability for damages and fees under § 512(f).';
export const CHANNELS = [
  ['A provider’s model outputs a copy or close variation of your work', 'The provider’s IP / copyright report form, plus its DMCA agent', 'Include the prompt, output, date, model name and your registration number. Ask that the output be blocked and the prompt filtered.'],
  ['Your work is hosted on a site or app running on a cloud platform', 'The host’s DMCA agent first; then the cloud provider’s abuse or acceptable-use reporting', 'Cloud providers generally act on the hosted customer, not on model behavior.'],
  ['You do not want future scraping for training', 'robots.txt rules for AI crawlers (e.g., GPTBot, Google-Extended, CCBot), provider opt-out forms, platform “no AI training” settings', 'Opt-outs usually apply going forward only and do not remove data from models already trained.'],
  ['You believe your work was used to train a model', 'Demand letter to the provider’s legal department; watch for class-action notices', 'Pending class actions (Andersen for visual art; book and music cases) may already cover you. Check class notices and settlement claim sites before filing alone.'],
  ['Ongoing, high-value misuse', 'A copyright attorney; a federal suit with registration in hand', 'Many firms take strong cases on contingency. Large companies will likely opt out of the Copyright Claims Board.'],
];
export const CASES = [
  ['Thomson Reuters v. Ross Intelligence', '3d Cir.', 'Affirmed Sept. 29, 2026: training a competing, non-generative search tool on 2,243 Westlaw headnotes was not fair use. Ross says it will seek Supreme Court review.', 'First appellate AI-training ruling. It recognizes AI training licenses as a real market, and it distinguished generative tools that create new expression.'],
  ['Bartz v. Anthropic', 'N.D. Cal.', '$1.5B class settlement approved July 20, 2026, about $3,000 per work. June 2025 ruling: training on lawfully bought books was fair use; building a library from pirated copies was not.', 'How training data is acquired matters. District-level only, not binding precedent.'],
  ['Kadrey v. Meta', 'N.D. Cal.', 'June 25, 2025: fair use for Meta on that record, because the 13 authors did not prove market harm. The judge warned that “market dilution” will often defeat fair use with better evidence.', 'Market substitution by AI output is the theory plaintiffs will push next, especially for image, music and stock-media markets.'],
  ['Thaler v. Perlmutter', 'U.S. Supreme Court', 'Certiorari denied March 2, 2026, leaving the D.C. Circuit ruling in place.', 'Fully autonomous AI output cannot be copyrighted. Raw generations may not be protectable.'],
  ['Allen v. Perlmutter (Théâtre D’opéra Spatial)', 'D. Colo.', 'Filed Sept. 2024 after the Office refused registration of a Midjourney image made with 624+ prompts plus Photoshop edits; only the human edits were registrable.', 'Keep records of your own source art and edits, and disclaim the AI-generated parts when registering.'],
  ['Disney, Universal & Warner Bros. v. Midjourney', 'C.D. Cal.', 'Filed June 2025, consolidated Nov. 2025; in discovery in 2026. Studios say Midjourney ignored their pre-suit demand letters.', 'Output of famous characters is the highest-risk area. Ignoring a C&D is cited as evidence of willfulness.'],
  ['Andersen v. Stability AI', 'N.D. Cal.', 'Artists v. Stability, Midjourney, DeviantArt, Runway. Copyright and inducement claims survived; CMI (§ 1202) claims dismissed. Summary judgment hearing moved to Feb. 17, 2027.', 'The “model itself is an infringing copy” and inducement theories are still live for distributors of open weights.'],
  ['UMG/Sony/Warner v. Suno and Udio', 'D. Mass. / S.D.N.Y.', 'UMG and Warner settled with Udio and licensed it; Warner settled with Suno. Sony is still litigating against both; UMG still against Suno.', 'Music generation is moving to licensed, “walled garden” models.'],
  ['Getty Images v. Stability AI', 'UK High Court', 'Nov. 4, 2025: secondary copyright claim failed (model weights held not to store copies); narrow trademark win over Getty watermarks in outputs. Appeal permitted. U.S. case separate.', 'Not U.S. law, but shows that watermarks or logos appearing in outputs create trademark exposure.'],
];

// ---- the agreement record (local only)
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
/** the current agreement {terms, agreedAt} or null (none, or made for older terms) */
export function consent() { const c = read(CONSENT_KEY); return c && c.terms === TERMS_VERSION && c.agreedAt ? c : null; }
export function agree() {
  const c = { terms: TERMS_VERSION, agreedAt: new Date().toISOString(), cards: CARDS.length };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch (e) { /* private mode: the engine will refuse; the app says so */ }
  return consent();
}
/** one upload attestation, kept on this phone: when, which file (SHA-256), which terms, the exact text shown */
export async function logUpload(blob) {
  let sha = '';
  try { sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { /* no WebCrypto */ }
  const list = (read(UPLOADS_KEY) || []).slice(-49);
  list.push({ at: new Date().toISOString(), sha256: sha, terms: TERMS_VERSION, text: ATTEST });
  try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(list)); } catch (e) { /* full: the box still gates Make */ }
}
