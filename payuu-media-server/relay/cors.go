package relay

import (
	"net/http"

	"payuu-media-server/config"
)

// ApplyCORS sets an Access-Control-Allow-Origin header echoing the request's
// Origin only if it is present in cfg.AllowedOrigins. It never sets "*".
// If the origin is not allowed, no CORS header is set and the browser will
// block the response — this is standard, correct behavior, not an error.
func ApplyCORS(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	origin := r.Header.Get("Origin")
	allowed := cfg.ResolveOrigin(origin)
	if allowed != "" {
		w.Header().Set("Access-Control-Allow-Origin", allowed)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Payuu-Destinations")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
		}
	}
}
