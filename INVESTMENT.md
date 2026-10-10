# Stock sale fix

For an existing Supabase installation, execute all of `investment-sale-fix.sql`
in SQL Editor, then refresh the stock page. A web deployment alone does not
replace the database RPC. New installations include the fix in
`supabase-schema.sql`.

Missing holdings are treated as zero shares. The server locks the investor and
holding, rejects insufficient shares, and credits cash only after a successful
share deduction. The UI disables sell/max-sell for unowned assets and checks the
latest loaded holding before submitting a sale. The database remains authoritative
when another tab has changed the holding.

This migration does not alter existing balances or holdings, or attempt to undo
past invalid sales.
