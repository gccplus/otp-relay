ALTER TABLE pairings
  ADD COLUMN IF NOT EXISTS android_credential_fingerprint VARCHAR(64);

ALTER TABLE pairings
  ADD COLUMN IF NOT EXISTS mac_credential_fingerprint VARCHAR(64);

DELETE FROM pairings
WHERE
  android_credential_fingerprint IS NULL
  OR mac_credential_fingerprint IS NULL;

ALTER TABLE pairings
  ALTER COLUMN android_credential_fingerprint SET NOT NULL;

ALTER TABLE pairings
  ALTER COLUMN mac_credential_fingerprint SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS android_credential_fingerprint_idx
  ON pairings (android_credential_fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS mac_credential_fingerprint_idx
  ON pairings (mac_credential_fingerprint);
