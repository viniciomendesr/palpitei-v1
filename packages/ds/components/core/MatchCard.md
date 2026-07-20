---
category: Core
---

Match fixture card used in home lists.

```jsx
<MatchCard live status="AO VIVO · 64’" group="GRUPO J" teamA="Argentina" teamB="Cabo Verde" scoreA={2} scoreB={1} cta="Entrar na sala →" />
```

A replay carries a second action in the same row. It is rendered disabled rather than
hidden when the fan never played, so they can tell the feature exists for them.

```jsx
<MatchCard status="REPLAY" group="COPA · TXLINE" teamA="Inglaterra" teamB="Argentina"
           cta="Rever partida →" secondaryCta="Meus palpites" onSecondary={abrir} />
```