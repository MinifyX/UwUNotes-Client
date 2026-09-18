# Vision

What I want UwUNotes to be, and what it will never do.

## The problem

Text editors fall into two camps, and both annoyed me.

**Notepad++, EditPlus, UltraEdit.** Fast, local, free, and completely stuck.
They open instantly, they hold forty tabs, they let you argue with a file's
encoding instead of guessing behind your back. They also look like 2004, their
settings are a wall of checkboxes nobody has grouped since, and every one of
them has a dialog you have to resize on every single launch.

**VS Code and the editors shaped like it.** Beautiful, modern, genuinely good at
being an IDE. That is the problem: it _is_ an IDE. It wants a workspace before
it wants to be useful, it takes seconds to show me a 40-line config file, it
ships an extension marketplace and a telemetry stream and an account button,
and half of what makes it slow is doing work I did not ask for on code I only
wanted to look at.

I wanted the second one's looks with the first one's manners.

## What UwUNotes is

A text and code editor for the files you open twenty times a day and close
again: a config, a log, a `.env`, a script, one function out of a repository you
have no intention of cloning.

Three things it has to get right:

1. **Open a file, see the file.** No project, no workspace, no indexing pass, no
   "trust the authors of this folder". A folder in the sidebar is an option for
   the times you want one, never a toll on the way in.
2. **Never mangle a file.** Encoding is detected, shown, and changeable; line
   endings survive a round trip; a lossy decode says so before you save over the
   original; a write is atomic and refuses to clobber a file that moved
   underneath it. An editor that quietly damages text has failed at the only
   job it has.
3. **Lose nothing when it closes.** Unsaved buffers come back, the split layout
   comes back, the carets come back. Closing the window should never be a
   decision.

## What it will never do

- **Phone home.** No telemetry, no analytics, no crash pings, no update ping, no
  account with me. It reads and writes files on your disk and that is the whole
  list of things it does with a network stack: nothing.
- **Sync your files through anybody's cloud, including mine.** Your files are
  already somewhere — a folder, a repository, a share you chose. An editor is
  the wrong layer to add a second copy at, and "your documents, on our servers"
  is not a feature I want to be responsible for.
- **Charge a subscription.** There is nothing here to rent. It is GPL, it is a
  binary, and it does not call anything that costs money to run.
- **Grow into an IDE.** No language servers, no debugger, no build system, no
  integrated terminal, no test runner, no marketplace. Syntax highlighting,
  brackets, indentation and a decent autocomplete over words already in the
  file — that is the shape, and the moment it starts wanting a project model it
  has become the thing I was running away from.
- **Guess silently.** Every guess the app makes about a file — its encoding, its
  line endings, its language — is visible in the status bar and one click from
  being overruled.
- **Make a warning cute.** Nyu is playful everywhere except where text could be
  lost. Overwrite, discard, replace-in-folder: plain, blunt, free of kaomoji, in
  both tones.
- **Be a team product.** No shared workspaces, no collaborative cursors, no
  comments. This is built for one person and their files.

## Who it's for

Me, first. If it fits you too, take it — it's GPL, fork it and make it yours.
But I build what I need, I answer issues when I get around to it, and I don't
promise a release schedule. That trade is the whole point: the app stays
opinionated because nobody has to be talked out of an opinion.
