# Human test script, 2026-11-10

Site: https://hmibuildtimecopilot.vercel.app. About 45 minutes. Use a normal browser window (A) and a private window (B).

Parts marked **[branch]** only work once `fix/leftovers` is merged and deployed. Until then, test them on a local build.

Write down for each failure: the step number, what you saw, and a screenshot. Keep DevTools Console open the whole time and note any red error, above all "Minified React error #418".

## 1. Signed out (window B, 5 min)

1. Open `/`. The landing loads and scrolls to the bottom. The animated screen plays.
2. Click every button on the landing. "Start a project" and "Open an existing .eote" must do different things.
3. Open `/account`. It sends you to `/signin?next=/account`.
4. Start a project signed out and ask the Copilot for something. A sign-in prompt appears and says why. It must not say "offline".
5. Close the prompt with Esc, with the X, and by clicking outside. All three work.
6. **[branch]** The browser tab shows the green chevron icon.

## 2. Sign up and sign in (window A, 5 min)

Use your own real account. Do not make throwaway accounts on the live site.

1. `/signup`: the split page shows, tabs slide between Sign in and Sign up. Wrong password shows an error on screen.
2. Sign in. You land where `next` pointed.
3. Open `/signin` while signed in. It sends you straight on.
4. Reload `/signin` (signed out, window B) 15 times. No blank flash, no #418 in the console.
5. Switch to the light theme, then reload `/signin` 10 times in window B. It stays light every time. **[branch]** for the guard.

## 3. Account (5 min)

1. `/account` at a short window (drag it to about 600 px tall). Scroll with the mouse wheel to "Delete account".
2. **[branch]** The page has the grid and light, an Account / Connections tab row, and a profile card with your initial.
3. Change password, then sign in with the new one. Change it back.
4. "Sign out everywhere": window A is signed out. Sign in again.
5. Delete account: the button stays disabled until you type DELETE. **Do not press it.**
6. On a phone (or DevTools at 390 px): no sideways scroll on `/account` and `/signup`.

## 4. A project from tags (10 min)

1. Start a project from `Plant_Tags.csv` (in `/demo`). Screens are generated.
2. No card boxes; one alarm banner line that opens an Alarms screen; objects sit on the 4 px grid.
3. Select, move, align and resize objects. Undo and redo.
4. Ask the Copilot: "add a lamp for the pump running tag and bind it". It lands and is bound.
5. **[branch]** Ask: "add a string display and bind it to" a BOOL tag. It refuses and says a StringDisplay shows only a STRING tag.
6. Agent tab: give it a multi-step job ("make an overview screen with every pump"). Steps show as they run.
7. Reload the page. The project reopens on the canvas, not on the "New project" pane.
8. Projects page: rename and duplicate from the card. "Opened <file>" stays after the first autosave.

## 5. An engineer's .eote (5 min)

1. Open `HMICopilot_Panel1.eote`. Screens draw, Compound Objects draw and can be selected and moved.
2. Known gap, not a failure: the master screen frame (header, clock) is not shown (S1-10), and TIME / USINT / structured variables are not listed (S1-12).
3. Edit one thing and export.

## 6. Export and OTE (10 min, needs the licensed editor)

1. Export. The zip holds the .eote, Variables.csv, a report and a README.
2. Open the .eote in OTE 4.4.20.31. It opens with no error.
3. Press Simulate. It runs, and the bound lamp follows its tag.
4. Try exporting a project with a broken binding (delete a tag that is bound). Export refuses and lists every problem at once.

## 7. Sharing and co-editing (5 min, windows A and B as two accounts)

1. A: Share the project, invite B.
2. Both open it. Move an object in A: it moves in B within a second or two.
3. Both edit different objects at once. Both edits stay.
4. A asks the Copilot for a change. It shows in B without a reload.
5. Add a comment in B. A sees it.
6. A removes B. B is refused on the next action, with a reason on screen.
7. History: restore an older version. The canvas goes back.

## 8. The claude.ai connector (5 min)

1. `/account/connections`: the set-up card shows the steps.
2. Add the connector in claude.ai. The consent screen shows, scrolls, and Approve returns to Claude.
3. In Claude: list projects, open one, ask it to add an object. The change shows in the open tab.
4. Back on `/account/connections`: the client is listed. Disconnect it. Claude's next call is refused.

## 9. Limits and errors (3 min)

1. Upload a file that is not a tag export or .eote. It is refused with a sentence that says why.
2. Upload something over the size limit. Same: a reason on screen.
3. `/reset/abc`: the page loads and scrolls. A wrong token is refused politely.
