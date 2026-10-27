---
name: make-a-game
description: How a game for p0pc0rn is made: Juli fills a game design's slots; a new game (chess, checkers, cards) needs its own design, written on the Game Kit.
for: [game]
---
## Making a game app (Juli)
- A game app comes from a game design (the Games list). Fill its slots: names, colours that are easy to tell apart and who starts. Juli always plays her best: there are no levels.
- No design for that game (chess, checkers, cards): say so plainly. A new game needs its own design: the guide for AI helpers on the Apps screen, given to an AI helper such as Claude, which writes one on the Game Kit.

## A new game on the Game Kit (an AI helper)
1. Rules first, pure, in a RULES block: the board, the legal moves, a move, the winner, the facts a player needs.
2. K.game.match runs the turns, saves every move and keeps the score. On Juli's turn it asks her with K.choose: EVERY legal move (at most 12), labelled in words. Her answer is her move; an unclear one is asked again; if her model gives none, show "Ask Juli again". Never make a move for her.
3. The game's read is her hint: look ahead (K.game.search, in slices with K.game.work) and say plainly what each of HER choices leads to ("wins now", "loses at once", "even"), best first, and the same words beside each option. Information only, never a filter.
4. Feel: K.game.board and K.game.piece for the art, K.game.fall, timeline and jolt for motion, K.game.confetti, K.game.sound (silent until the first tap, a remembered mute), K.game.results for the end.
5. Everyone: K.game.a11y.say for what happened, K.game.a11y.controls for buttons a screen reader can press, K.game.reduced for calmer motion.
6. Test it with window.SLOTS = {} and without window.p0.
