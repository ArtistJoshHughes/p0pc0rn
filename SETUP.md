# Using p0pc0rn

**The app is at [https://artistjoshhughes.github.io/p0pc0rn/](https://artistjoshhughes.github.io/p0pc0rn/).** Open it on your phone:
there is nothing to install. The phone does all the work. The site only hands it the app's files, and the models download from
Hugging Face.

Running your own copy instead is optional, and it has its own rules (the end of this page).

## What you need

- **A phone with WebGPU:**
  - **iPhone:** iOS 26 or later, in Safari.
    - On iOS 18, WebGPU sits behind a Safari feature flag; that's untested.
    - The test phone is an iPhone 16 Pro Max. Phones with less memory may struggle with the bigger models.
  - **Android (Chrome): experimental. It was prepared on a desktop with Android-like limits; the first device test (Pixel 10) is pending.**
    - Use Chrome, kept up to date.
    - First open **Settings › About › Device check** (or `devcheck.html`), tap **Run the check**, then **Copy report**. It lists
      what the phone's graphics chip offers and which models fit.
    - Share the report in a GitHub issue or a DM to @p0pc0rnapp.
    - If the check says there is no WebGPU: update Chrome and restart the phone.
    - Last resort, for testing only: set `chrome://flags/#enable-unsafe-webgpu` to Enabled, then relaunch Chrome. It turns on
      WebGPU for graphics chips Chrome has not approved yet, and it can crash Chrome or the graphics driver. Turn it off after testing.
- **Wi-Fi** for the downloads, and the phone plugged in while it downloads and renders.
- **Storage on the phone**, per feature:

  | Feature | Download | Also needs |
  |---|---|---|
  | Pictures (FLUX.2 Klein 4B) | 4.6 GB | |
  | Better pictures (Klein 9B, optional: slower, better) | about 9.6 GB | Pictures |
  | Videos (SANA-Video 2.0 5B) | 5.7 GB | |
  | Clips from a picture, or between two pictures (picture reader) | 0.2 GB | Videos |
  | Assistant (Gemma 4 E2B) | 3.3 GB | |
  | Songs (ACE-Step 1.5 turbo) | 2.8 GB | |
  | Lyrics planner (optional) | 0.9 GB | Songs |
  | Starter knowledge (offline Wikipedia facts) | 3 MB | Assistant |
  | Cast voices (Qwen3-TTS) | 1.4 GB | |
  | Lip-sync (experimental) | 1.0 GB | Voice |

  - Music videos use Assistant, Songs, Pictures, Videos and the picture reader.
  - Everything in the table comes to about 20 GB without the 9B, and about 30 GB with it.
  - Keep a few GB free on top.

## First run on the phone

1. **Open https://artistjoshhughes.github.io/p0pc0rn/.** Use Safari on iPhone, or Chrome on Android (experimental; run the Device
   check first, above).
2. **iPhone: add it to your Home Screen first.**
   - Tap Share › Add to Home Screen, then open p0pc0rn from the new icon and do everything else there.
   - iOS keeps the Home Screen app apart from Safari: models and your agreement in one aren't in the other.
3. **Agree.** p0pc0rn opens in the Assistant chat with the rights lesson on top. Read it and tap **I agree**. Nothing can be made
   before that.
4. **Settings › Storage › Protected from iOS cleanup › Allow.**
5. **Download what you want.** The chat's first message offers the assistant and the starter knowledge as one download (3.3 GB).
   Ask it for a picture, a song or a clip, and it offers that model if it isn't on the phone yet. **Settings › Models** has every
   model: tap **Download** there.
   - Each model shows its licence first. Read it and accept.
   - Keep the app in front, the phone plugged in and on Wi-Fi.
   - If the download stops (screen lock, app in the background), it picks up where it left off when you're back.
6. **Make something:** ask the assistant, or on **Create** describe a picture and tap **Make**. A picture takes about 2 to 3 minutes;
   a 5-second clip about 6.

## Storage tips

- Download in the place you'll use: on iPhone, the Home Screen icon (or Safari, but not both).
- Private browsing can't keep models or your agreement.
- Your Library lives in the app's storage. Save the things you want to keep to Photos or Files.
- Out of space? Settings › Models: delete what you don't use. Your Library stays.
- iOS may clear a website's data when space runs low, or when the site hasn't been used for a while. The Home Screen icon and
  "Protected from iOS cleanup" make that less likely.

## Updating

- The site updates when Josh Hughes publishes a new version.
- To get it, close the app and open it again; on iPhone, close it from the app switcher. A new version can take a few minutes to
  reach you.
- Your models and your Library stay on the phone.

## Help

- Bugs and feedback: [GitHub issues](https://github.com/ArtistJoshHughes/p0pc0rn/issues). Issues are public, so leave out personal
  photos, voices, anyone's likeness and anything private.
- Security problems: [SECURITY.md](SECURITY.md) (a DM, not an issue).
- On X: [@p0pc0rnapp](https://x.com/p0pc0rnapp) or [@joshhughes___](https://x.com/joshhughes___).

---

## Running your own copy (optional, only for yourself)

**The licence lets you run your own copy only for yourself** (LICENSE.md). So the server listens only on your own computer, and
your phone reaches it through your own private Tailscale network.

**No public tunnels:**
- no `tailscale funnel`, ngrok, Cloudflare Tunnel or localtunnel;
- no router port forwarding;
- no sharing the address.

Your copy has its own storage, so models and the agreement from the official site aren't in it.

If you use Claude Code, open the folder and say "set up p0pc0rn with me". It follows CLAUDE.md and walks you through these steps.
It takes about 20 minutes, plus the model downloads.

**You need** a computer (a Mac, a Windows PC or Linux) with Python 3.8 or later and git.

**Why HTTPS:** WebGPU, and the private storage where the models live (OPFS), only work on a secure page. That means `https://`, or
`localhost` on the same device. Your phone isn't the computer, so it needs HTTPS. Tailscale gives you that inside your own
network, free.

### 1. Get the code

```
git clone https://github.com/ArtistJoshHughes/p0pc0rn.git
cd p0pc0rn
```

### 2. Start the server

```
python3 tools/serve.py             # Windows: py tools/serve.py
```

- It serves the app at `http://127.0.0.1:8080/`, which only this computer can reach. Leave it running.
- If 8080 is taken, add `--port 8090` and use 8090 below as well.

### 3a. Your phone, through Tailscale (recommended)

**On the phone:** install Tailscale from the App Store or Google Play. Sign in, and switch it on.

**On the computer:** install Tailscale and sign in with the **same account**. Then, in a second terminal:

- **macOS.** Install Tailscale from tailscale.com/download or the Mac App Store, then:
  ```
  tailscale serve --bg 8080
  tailscale serve status
  ```
  If Terminal says `tailscale: command not found`, type `/Applications/Tailscale.app/Contents/MacOS/Tailscale` in place of
  `tailscale`.
- **Windows (PowerShell).** Run `winget install --id Tailscale.Tailscale -e` (or use the installer from tailscale.com/download).
  Sign in from the tray icon, open a new PowerShell window, then:
  ```
  tailscale serve --bg 8080
  tailscale serve status
  ```
- **Linux:**
  ```
  curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up
  sudo tailscale serve --bg 8080
  tailscale serve status
  ```

**The first time,** `tailscale serve` may say HTTPS isn't enabled and print a link. Open it, turn on HTTPS certificates (and
MagicDNS if it asks), and run the command again. `tailscale serve status` then shows your address, in the form
`https://<your-computer>.<your-tailnet>.ts.net/`. Only devices signed in to your tailnet can open it.

**Privacy note:** HTTPS certificates go into a public log, so your computer's name and your tailnet's name become public. If your
computer's name is personal, rename it in the Tailscale admin console first.

**To stop:**
- `tailscale serve reset` removes the HTTPS entry;
- Ctrl+C stops the server.

After a reboot, only `tools/serve.py` needs starting again.

### 3b. Localhost only (trying it on the computer)

With the server running, open `http://127.0.0.1:8080/` in Chrome or Edge, or Safari 26 on a Mac. `localhost` counts as secure, so
WebGPU works. The models download into that browser's own storage.

**Android over USB, without Tailscale:** run `adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080/` in Chrome on the
phone.

### 4. On the phone

Open your `https://…ts.net` address, then follow "First run on the phone" above.

**To update your copy:** run `git pull`, then close and reopen the app. Your models stay on the phone.
