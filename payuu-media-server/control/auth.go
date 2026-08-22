package control

import (
	"net/http"
	"strings"
)

// AuthenticateRequest validates bearer tokens for WHIP and control endpoints
func AuthenticateRequest(r *http.Request, requiredToken string) bool {
	if requiredToken == "" {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return false
	}

	return parts[1] == requiredToken
}
