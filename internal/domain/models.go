package domain

type Note struct {
	Rating     int      `json:"rating"`
	DeletedAt  string   `json:"deleted_at,omitempty"`
	ID         string   `json:"id"`
	Platform   string   `json:"platform"`
	NoteID     string   `json:"note_id"`
	URL        string   `json:"url"`
	Title      string   `json:"title"`
	Author     string   `json:"author"`
	Kind       string   `json:"kind"`
	RevisionID string   `json:"revision_id"`
	Tags       []string `json:"tags"`
	Likes      *int64   `json:"likes"`
	Favorites  *int64   `json:"favorites"`
	Comments   *int64   `json:"comments"`
	CreatedAt  string   `json:"created_at"`
	UpdatedAt  string   `json:"updated_at"`
}
type Revision struct {
	ID          string   `json:"id"`
	NoteID      string   `json:"note_id"`
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Body        string   `json:"body"`
	Topics      []string `json:"topics"`
	Author      string   `json:"author"`
	AuthorID    string   `json:"author_id"`
	PublishedAt string   `json:"published_at"`
	Kind        string   `json:"kind"`
	AssetIDs    []string `json:"asset_ids"`
	CreatedAt   string   `json:"created_at"`
}
type Asset struct {
	// Empty preserves existing library entries; result requires explicit library save.
	LibraryState   string  `json:"library_state,omitempty"`
	ProjectID      string  `json:"project_id,omitempty"`
	ProjectName    string  `json:"project_name,omitempty"`
	ScriptID       string  `json:"script_id,omitempty"`
	ScriptTitle    string  `json:"script_title,omitempty"`
	DeletedAt      string  `json:"deleted_at,omitempty"`
	OriginalName   string  `json:"original_name,omitempty"`
	NameCustomized bool    `json:"name_customized,omitempty"`
	Category       string  `json:"category,omitempty"`
	UpdatedAt      string  `json:"updated_at,omitempty"`
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Kind           string  `json:"kind"`
	MIME           string  `json:"mime"`
	Path           string  `json:"path"`
	Source         string  `json:"source"`
	RemoteURL      string  `json:"remote_url,omitempty"`
	RevisionID     string  `json:"revision_id,omitempty"`
	Role           string  `json:"role,omitempty"`
	Position       int     `json:"position"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Duration       float64 `json:"duration"`
	Size           int64   `json:"size"`
	SHA256         string  `json:"sha256"`
	Status         string  `json:"status"`
	Error          string  `json:"error,omitempty"`
	CreatedAt      string  `json:"created_at"`
}
type Segment struct {
	StartMS int64  `json:"start_ms"`
	EndMS   int64  `json:"end_ms"`
	Text    string `json:"text"`
}
type Extraction struct {
	ID               string    `json:"id"`
	AssetID          string    `json:"asset_id"`
	Kind             string    `json:"kind"`
	Original         string    `json:"original"`
	Text             string    `json:"text"`
	Segments         []Segment `json:"segments"`
	OriginalSegments []Segment `json:"original_segments"`
	Edited           bool      `json:"edited"`
	UpdatedAt        string    `json:"updated_at"`
}
type Source struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Text  string `json:"text"`
}
type Project struct {
	SelectedVersions map[string]string         `json:"selected_versions,omitempty"`
	Drafts           map[string]RewriteDraft   `json:"drafts,omitempty"`
	Platform         string                    `json:"platform"`
	DeletedAt        string                    `json:"deleted_at,omitempty"`
	MediaSelections  map[string]MediaSelection `json:"media_selections,omitempty"`
	AssetIDs         []string                  `json:"asset_ids"`
	Kind             string                    `json:"kind"`
	CoverID          string                    `json:"cover_id"`
	ID               string                    `json:"id"`
	Name             string                    `json:"name"`
	NoteID           string                    `json:"note_id,omitempty"`
	RevisionID       string                    `json:"revision_id,omitempty"`
	Sources          []Source                  `json:"sources"`
	CreatedAt        string                    `json:"created_at"`
}
type MediaSelection struct {
	AssetIDs []string `json:"asset_ids"`
	CoverID  string   `json:"cover_id"`
}
type Content struct {
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Topics []string `json:"topics"`
}
type Version struct {
	WorkflowSnapshot  map[string]string  `json:"workflow_snapshot,omitempty"`
	Generated         bool               `json:"generated,omitempty"`
	Creative          *CreativeSettings  `json:"creative,omitempty"`
	GenerationRecords []GenerationRecord `json:"generation_records,omitempty"`
	Hook              string             `json:"hook,omitempty"`
	Name              string             `json:"name,omitempty"`
	SourceSnapshot    []Source           `json:"source_snapshot,omitempty"`
	Media             *VersionMedia      `json:"media,omitempty"`
	ID                string             `json:"id"`
	ProjectID         string             `json:"project_id"`
	Number            int                `json:"number"`
	Content
	Status       string   `json:"status"`
	SourceIDs    []string `json:"source_ids"`
	Instructions string   `json:"instructions"`
	Model        string   `json:"model,omitempty"`
	ModelName    string   `json:"model_name,omitempty"`
	ParentID     string   `json:"parent_id,omitempty"`
	CreatedAt    string   `json:"created_at"`
	ConfirmedAt  string   `json:"confirmed_at,omitempty"`
}
type VersionMedia struct {
	Kind     string   `json:"kind"`
	AssetIDs []string `json:"asset_ids"`
	CoverID  string   `json:"cover_id"`
}
type RewriteDraft struct {
	EditedAt     string            `json:"edited_at,omitempty"`
	Revision     int               `json:"revision"`
	SavedAt      string            `json:"saved_at"`
	Content      Content           `json:"content"`
	VersionID    string            `json:"versionID"`
	SourceIDs    []string          `json:"sourceIDs"`
	Media        *VersionMedia     `json:"media"`
	Creative     *CreativeSettings `json:"creative,omitempty"`
	Audience     string            `json:"audience"`
	Tone         string            `json:"tone"`
	Length       string            `json:"length"`
	Requirements string            `json:"requirements"`
	ModelID      string            `json:"modelID"`
	Hook         string            `json:"hook"`
}
type Publication struct {
	ManualStatus    string `json:"manual_status,omitempty"`
	Revision        int    `json:"revision,omitempty"`
	WorkflowManaged bool   `json:"workflow_managed,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
	ConfirmedAt     string `json:"confirmed_at,omitempty"`
	DeletedAt       string `json:"deleted_at,omitempty"`
	GroupID         string `json:"group_id,omitempty"`
	SharedDraftID   string `json:"shared_draft_id,omitempty"`
	CreationID      string `json:"creation_id,omitempty"`
	TargetPlatform  string `json:"target_platform"`
	RemoteWorkID    string `json:"remote_work_id,omitempty"`
	Visibility      string `json:"visibility,omitempty"`
	OnlineState     string `json:"online_state,omitempty"`
	OnlineJobID     string `json:"online_job_id,omitempty"`
	OnlineAccount   string `json:"online_account,omitempty"`
	SubmittedAt     string `json:"submitted_at,omitempty"`
	ID              string `json:"id"`
	ProjectID       string `json:"project_id"`
	VersionID       string `json:"version_id"`
	Content
	Kind         string   `json:"kind"`
	AssetIDs     []string `json:"asset_ids"`
	CoverID      string   `json:"cover_id,omitempty"`
	Ready        bool     `json:"ready"`
	ExportedAt   []string `json:"exported_at"`
	PublishedAt  string   `json:"published_at,omitempty"`
	PublishedURL string   `json:"published_url,omitempty"`
	CreatedAt    string   `json:"created_at"`
}
type Job struct {
	TaskProject      *TaskProjectRef `json:"task_project,omitempty"`
	HistoryDeletedAt string          `json:"history_deleted_at,omitempty"`
	ID               string          `json:"id"`
	Kind             string          `json:"kind"`
	Target           string          `json:"target"`
	State            string          `json:"state"`
	Stage            string          `json:"stage"`
	Error            string          `json:"error,omitempty"`
	Payload          map[string]any  `json:"payload"`
	Result           string          `json:"result,omitempty"`
	Attempts         int             `json:"attempts"`
	CreatedAt        string          `json:"created_at"`
	UpdatedAt        string          `json:"updated_at"`
}
type TaskProjectRef struct {
	Category          string `json:"category"`
	ID                string `json:"id"`
	Name              string `json:"name"`
	ItemName          string `json:"item_name,omitempty"`
	RevisionID        string `json:"revision_id,omitempty"`
	CurrentRevisionID string `json:"current_revision_id,omitempty"`
}
type Service struct {
	BaseURL    string `json:"base_url"`
	Model      string `json:"model"`
	Secret     string `json:"secret,omitempty"`
	Configured bool   `json:"configured"`
	Mask       string `json:"mask,omitempty"`
}
type Settings struct {
	Text         Service `json:"text"`
	OCR          Service `json:"ocr"`
	ASR          Service `json:"asr"`
	CollectorURL string  `json:"collector_url"`
}
