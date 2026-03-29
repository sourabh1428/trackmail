-- D1 doesn't support ALTER COLUMN, so recreate the table without NOT NULL on bunch_id
-- and migrate existing data.

CREATE TABLE IF NOT EXISTS tracking_events_new (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT    NOT NULL,
  event     TEXT    NOT NULL,   -- 'open' | 'click'
  bunch_id  TEXT,               -- nullable: not all tracking URLs include bid
  url       TEXT,               -- only set for click events
  ip        TEXT,
  timestamp TEXT    NOT NULL    -- ISO-8601 UTC string
);

INSERT INTO tracking_events_new (id, email, event, bunch_id, url, ip, timestamp)
  SELECT id, email, event, NULLIF(bunch_id, ''), url, ip, timestamp
  FROM tracking_events;

DROP TABLE tracking_events;

ALTER TABLE tracking_events_new RENAME TO tracking_events;

CREATE INDEX IF NOT EXISTS idx_te_bunch_id    ON tracking_events (bunch_id);
CREATE INDEX IF NOT EXISTS idx_te_email_event ON tracking_events (email, event);
