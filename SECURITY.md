# Security

## Reporting a problem

Please report it privately, by **a direct message on X** to [@p0pc0rnapp](https://x.com/p0pc0rnapp) (official) or
[@joshhughes___](https://x.com/joshhughes___) (Josh). GitHub issues on this repository are public, so don't put security details
in one.

There is no e-mail contact and no bounty. Please include:
- what you found and how to reproduce it;
- the app version (Settings › About);
- your phone, OS and browser;
- what someone could do with it.

Leave out tokens, any private address of yours and anyone's personal media.

Test against your own copy or your own phone, never anyone else's, and don't share the details until there's a fix.

## In scope

- **The app and engine code in this repository**, for example:
  - script injection from prompts, file names, or Wikipedia and Fandom content;
  - data leaving the phone that shouldn't;
  - saved or shared files carrying anything beyond the label "AI-generated with p0pc0rn".
- **Getting around a safeguard:**
  - the rights lesson or the agreement gate;
  - the per-upload ownership tick;
  - the engine's consent check;
  - a model-licence sheet;
  - the Cast consent and likeness checks.

  Prompt tricks count when they make the assistant run a tool past one of these checks.
- **Model downloads:**
  - skipping the sha256 checks against the pinned manifest;
  - fetching from a host other than the configured one;
  - a Hugging Face sign-in token being exposed.
- **`tools/serve.py`:** serving files outside the root, dotfiles, folder listings, or listening beyond 127.0.0.1 without a warning.
- **`tools/scan_secrets.py`** missing a private item. So does any token, key, address or personal path found in the repository.

## Out of scope

- The quality or content of model outputs, unless they get around a safeguard. Report harmful outputs anyway; they help.
- The third-party models and their licences. Report those to their publishers.
- Problems in Tailscale, GitHub, Hugging Face, iOS, Android or the browsers themselves.
- Copies that someone else has modified, and attacks that need an unlocked phone in hand.
- Overloading your own server.
