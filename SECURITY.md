# Security

## Reporting a problem

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for them.

Include what you found, how to reproduce it, and which version and OS you used. You'll get a reply within a week.

## What counts

- A project file, media file or subtitle file that makes Lumacut run code, read files it shouldn't, or reach the network
- Ways for page content to reach Node.js or the file system from the app window
- API keys leaking into logs, project files or crash reports

## How the app is set up

- The app window runs sandboxed with context isolation and no Node.js access. It talks to the rest of the app through a fixed list of validated messages.
- The window never loads remote pages. Links open in your browser.
- Downloaded tools (FFmpeg) are checked against pinned SHA-256 hashes before use.
