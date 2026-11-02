# stats-card

A Claude Code mod that brings back the usage stats card from the old new-session screen: sessions, messages, total tokens, active days, peak hour, favorite model, a 26-week activity heatmap and a "more tokens than Moby-Dick" line. A Models tab shows each model's share and tokens per day, and All, 30d and 7d change the range.

It is a panel, not part of the new-session screen, because mods can't draw on that screen. In the desktop app the card opens when a new session starts, and `/stats-card` opens it any time. In a terminal it shows the same numbers as text when you run the command.

The numbers are counted on your computer from the transcripts in `~/.claude/projects`, and nothing is sent anywhere. It needs Node on your PATH.

Known issue: the panel has closed once after pressing Models, and the cause isn't known yet. `/stats-card` reopens it.

## Install

At the prompt of a terminal session:

```
/plugin install stats-card --marketplace MrCakeguy123/stats-card
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install stats-card --marketplace MrCakeguy123/stats-card
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `MrCakeguy123/stats-card`, then Add plugin.
