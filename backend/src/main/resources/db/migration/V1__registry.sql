CREATE TABLE site_family (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(200) NOT NULL, source_origin VARCHAR(512) NOT NULL UNIQUE,
 destination_origin VARCHAR(512) NOT NULL, state VARCHAR(32) NOT NULL CHECK (state IN ('active','revoked')),
 valid_until TIMESTAMP WITH TIME ZONE NOT NULL, revoked_at TIMESTAMP WITH TIME ZONE, revoke_reason VARCHAR(1000), version BIGINT NOT NULL DEFAULT 0,
 CHECK (source_origin <> destination_origin)
);
CREATE TABLE candidate (
 id VARCHAR(64) PRIMARY KEY, family_id VARCHAR(64), source_host VARCHAR(253) NOT NULL,
 proposed_origin VARCHAR(512) NOT NULL, reason VARCHAR(1000) NOT NULL,
 state VARCHAR(32) NOT NULL CHECK (state IN ('pending','approved','rejected','quarantined')),
 reviewer VARCHAR(200), submitter VARCHAR(200), version BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 FOREIGN KEY(family_id) REFERENCES site_family(id)
);
CREATE TABLE pending_decision (
 id VARCHAR(64) PRIMARY KEY, candidate_id VARCHAR(64) NOT NULL UNIQUE REFERENCES candidate(id),
 source_origin VARCHAR(512) NOT NULL, destination_origin VARCHAR(512) NOT NULL,
 reviewer VARCHAR(200) NOT NULL, reason VARCHAR(1000) NOT NULL, valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
 published_sequence BIGINT
);
CREATE TABLE registry_release (
 sequence BIGINT PRIMARY KEY, digest VARCHAR(64) NOT NULL UNIQUE, signed_blob TEXT NOT NULL,
 issued_at TIMESTAMP WITH TIME ZONE NOT NULL, expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
 publisher VARCHAR(200) NOT NULL
);
CREATE TABLE release_counter (id INTEGER PRIMARY KEY CHECK (id=1), next_sequence BIGINT NOT NULL);
INSERT INTO release_counter(id,next_sequence) VALUES(1,1);
CREATE TABLE audit_event (
 id VARCHAR(64) PRIMARY KEY, actor VARCHAR(200) NOT NULL, action VARCHAR(64) NOT NULL,
 entity_id VARCHAR(64) NOT NULL, detail VARCHAR(1000) NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE TABLE request_budget (
 bucket VARCHAR(200) PRIMARY KEY, window_start BIGINT NOT NULL, used INTEGER NOT NULL CHECK (used>=0)
);
CREATE TABLE lookup_job (
 id VARCHAR(64) PRIMARY KEY, hostname VARCHAR(253) NOT NULL, state VARCHAR(32) NOT NULL,
 attempt INTEGER NOT NULL DEFAULT 0, run_after TIMESTAMP WITH TIME ZONE NOT NULL,
 lease_owner VARCHAR(200), lease_until TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX lookup_jobs_ready ON lookup_job(state,run_after);
CREATE INDEX candidates_state ON candidate(state,created_at);
CREATE INDEX audit_created ON audit_event(created_at);
