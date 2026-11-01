# Stock investment migrations

For an existing Supabase installation, execute `investment-stock-split-fix.sql`
in SQL Editor after all previously applied investment SQL updates. It converts
stock prices and share counts to exact decimal types, keeps the full value of
each holding unchanged when shares are split, and installs the matching trade
and portfolio-state functions. New installations include these changes in
`supabase-schema.sql`. A web deployment alone does not replace database RPCs.

Missing holdings are treated as zero shares. The server locks the investor and
holding, rejects insufficient shares, and credits cash only after a successful
share deduction. The UI disables sell/max-sell for unowned assets and checks the
latest loaded holding before submitting a sale. The database remains authoritative
when another tab has changed the holding.

Because cash is stored in whole won while split share prices can be fractional,
buys round the total cost up and sells round proceeds down. This prevents
repeated small trades from creating value through per-trade rounding. Share
quantities must remain positive integers.

After the split migration, run `investment-reset-assets.sql` exactly once to
remove every existing investment holding and set every existing investment
user's cash to ₩5,000,000. A database marker rejects a second run. It does not
delete investment users, shop inventory, or any other game assets. Do not run
this reset from application startup or login code. It does not attempt to undo
past invalid sales; the explicit holdings reset removes any resulting stock
positions.

## Verification

Run `node --test investment-sale.test.mjs investment-split.test.mjs` to check
sale authorization, exact arithmetic across repeated splits, large quantities,
trade rounding rules, and the one-time reset scope. The SQL migrations must
still be applied in Supabase SQL Editor; repository tests do not apply them to
an operating database.
