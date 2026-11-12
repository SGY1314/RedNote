package domain

// CreativeSettings is an editable brief. Empty medium-specific angles inherit Angle.
type CreativeSettings struct {
	Topic       string `json:"topic,omitempty"`
	Angle       string `json:"angle,omitempty"`
	ImageAngle  string `json:"image_angle,omitempty"`
	ImageHook   string `json:"image_hook,omitempty"`
	ImageCustom string `json:"image_custom,omitempty"`
	VideoAngle  string `json:"video_angle,omitempty"`
	VideoHook   string `json:"video_hook,omitempty"`
	VideoCustom string `json:"video_custom,omitempty"`
}

// GenerationRecord contains only public creative inputs, never provider credentials.
type GenerationRecord struct {
	AssetID string         `json:"asset_id"`
	JobID   string         `json:"job_id"`
	Kind    string         `json:"kind"`
	Model   string         `json:"model,omitempty"`
	Details map[string]any `json:"details"`
}
