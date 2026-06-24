# Client Architecture

SpellKard owns input, presentation, local practice, replay playback, UI, and asset/theme handling.

In online play, the client is not authoritative. It sends input and card requests to Gensoulkyo and presents server-approved state.

The local prototype may run gameplay logic directly so movement, hitbox, graze, bomb, and replay feel can be tuned quickly.

