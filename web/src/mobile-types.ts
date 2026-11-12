export type MobileState = 'created' | 'scanned' | 'claimed' | 'editor_opened' | 'cancelled' | 'expired' | 'unknown';
export type MobileSession = {
  id: string;
  state: MobileState;
  expires_at: string;
  ticket?: string;
  miniapp_scheme_url?: string;
  qr_image?: string;
  qr_error?: string;
  launch_path?: string;
  client_event?: 'editor_open_requested' | 'client_publish_success' | 'client_publish_incomplete';
};
