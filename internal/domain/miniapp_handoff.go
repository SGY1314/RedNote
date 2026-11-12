package domain

// MiniappHandoffSnapshot contains only the immutable authoring payload. Local
// file paths, platform accounts and credentials never belong in this contract.
type MiniappHandoffSnapshot struct {
	PublicationID string                `json:"publication_id"`
	VersionID     string                `json:"version_id"`
	Title         string                `json:"title"`
	Body          string                `json:"body"`
	Topics        []string              `json:"topics"`
	Media         []MiniappHandoffMedia `json:"media"`
	Fingerprint   string                `json:"fingerprint"`
}

type MiniappHandoffMedia struct {
	AssetID    string  `json:"asset_id"`
	Kind       string  `json:"kind"`
	MIME       string  `json:"mime"`
	SHA256     string  `json:"sha256"`
	PreviewURL string  `json:"preview_url"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	Duration   float64 `json:"duration"`
	Size       int64   `json:"size"`
}

type MiniappHandoffEvent struct {
	State string `json:"state"`
	At    string `json:"at"`
}

// Development events are never platform receipts and do not change the
// Publication. No real miniapp identity or publish-success field is accepted.
type MiniappHandoffSession struct {
	SchemaVersion int                    `json:"schema_version"`
	Mode          string                 `json:"mode"`
	ID            string                 `json:"id"`
	PublicationID string                 `json:"publication_id"`
	State         string                 `json:"state"`
	ExpiresAt     string                 `json:"expires_at"`
	CreatedAt     string                 `json:"created_at"`
	UpdatedAt     string                 `json:"updated_at"`
	Snapshot      MiniappHandoffSnapshot `json:"snapshot"`
	Events        []MiniappHandoffEvent  `json:"events"`
}
