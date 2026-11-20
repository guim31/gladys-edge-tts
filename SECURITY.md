# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **No secret.** The service needs no account or key: the settings (voice,
  speed, pitch, volume) are kept by Gladys, and nothing is written to `/data`.
- **Network.** Outbound HTTPS and WebSocket (port 443) to
  `speech.platform.bing.com` only; no port is opened, nothing on the local
  network. Every text spoken leaves for Microsoft, with the public IP address
  of the connection, and a random visitor id (`muid`) per request.
- **Text in the SSML.** Texts are XML-escaped; a voice name typed by hand is
  checked against the shape of an Edge voice name before it is sent.
- Clips stay in memory (16 at most) and are lost at restart.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Microsoft service the integration talks to.
