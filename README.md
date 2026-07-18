# SPCX Tracker

Live tracker for SPCX (Space Exploration Technologies Corp., Nasdaq), styled like
a launch-telemetry screen. Fully static, free to run forever.

**How it works**

- `.github/workflows/update.yml` runs every 5 minutes (GitHub's fastest cron) and
  executes `scripts/fetch.mjs`, which pulls the latest price from Yahoo Finance's
  chart API and merges it into `data/history.json` — one daily OHLC candle per
  session since the IPO plus 5-minute intraday points (last 60 days). If the
  price moved, the workflow commits the file, which redeploys GitHub Pages.
- `index.html` renders the data: live price, day/since-IPO change, custom canvas
  chart (1D / 5D / 1M / All), stat grid, and a vehicle-status line that
  deteriorates with the day's performance.

**Local dev**

```
node scripts/fetch.mjs      # refresh data/history.json
node scripts/smoke-test.mjs # headless render test
python -m http.server 4599  # then open http://localhost:4599
```

Data via Yahoo Finance's unofficial API. Not investment advice.
