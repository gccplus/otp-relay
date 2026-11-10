CREATE TABLE IF NOT EXISTS pairings (
    pairing_id UUID PRIMARY KEY,
    android_device_id VARCHAR(128) NOT NULL,
    android_device_name VARCHAR(128) NOT NULL,
    mac_device_id VARCHAR(128) NOT NULL,
    mac_device_name VARCHAR(128) NOT NULL,
    mac_public_key TEXT NOT NULL,
    protocol_version SMALLINT NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'revoked')),
    android_credential_hash TEXT NOT NULL,
    android_credential_fingerprint VARCHAR(64) NOT NULL,
    mac_credential_hash TEXT NOT NULL,
    mac_credential_fingerprint VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_android_pairing
    ON pairings (android_device_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS one_active_mac_pairing
    ON pairings (mac_device_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS android_credential_fingerprint_idx
    ON pairings (android_credential_fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS mac_credential_fingerprint_idx
    ON pairings (mac_credential_fingerprint);

CREATE TABLE IF NOT EXISTS security_audit_events (
    event_id UUID PRIMARY KEY,
    pairing_id UUID,
    event_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    request_id VARCHAR(128)
);
