package config

import (
	"os"
	"strings"
)

type Config struct {
	Environment    string
	HTTPPort       string
	AuthToken      string
	STUNServers    []string
	TURNServer     string
	TURNUsername   string
	TURNPassword   string
	AllowedOrigins []string
	ICEUDPMin      uint16
	ICEUDPMax      uint16
}

func LoadConfig() *Config {
	port := os.Getenv("PAYUU_HTTP_PORT")
	if port == "" {
		port = "8080"
	}

	token := os.Getenv("PAYUU_AUTH_TOKEN")
	if token == "" {
		token = "" // No default secret; development may explicitly set PAYUU_AUTH_TOKEN
	}

	stunEnv := os.Getenv("PAYUU_STUN_SERVERS")
	stunServers := []string{"stun:stun.l.google.com:19302"}
	if stunEnv != "" {
		stunServers = strings.Split(stunEnv, ",")
	}

	// Allowed CORS origins are explicit and configurable. Default to local
	// development origins only — production origins must be set via
	// PAYUU_ALLOWED_ORIGINS (comma-separated) and should never be "*".
	originsEnv := os.Getenv("PAYUU_ALLOWED_ORIGINS")
	allowedOrigins := []string{
		"http://localhost:3000",
		"http://127.0.0.1:3000",
	}
	if originsEnv != "" {
		allowedOrigins = []string{}
		for _, o := range strings.Split(originsEnv, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowedOrigins = append(allowedOrigins, o)
			}
		}
	}

	minPort := uint16(50000)
	maxPort := uint16(50050)
	return &Config{
		Environment:    os.Getenv("PAYUU_ENV"),
		HTTPPort:       port,
		AuthToken:      token,
		STUNServers:    stunServers,
		TURNServer:     os.Getenv("PAYUU_TURN_SERVER"),
		TURNUsername:   os.Getenv("PAYUU_TURN_USERNAME"),
		TURNPassword:   os.Getenv("PAYUU_TURN_PASSWORD"),
		AllowedOrigins: allowedOrigins,
		ICEUDPMin:      minPort,
		ICEUDPMax:      maxPort,
	}
}

// ResolveOrigin returns originHeader if it is present in AllowedOrigins,
// otherwise "". Never returns "*" — every response echoes back a single
// explicitly-allowed origin, which is required for credentialed requests
// and avoids wildcard production CORS.
func (c *Config) ResolveOrigin(originHeader string) string {
	if originHeader == "" {
		return ""
	}
	for _, o := range c.AllowedOrigins {
		if o == originHeader {
			return o
		}
	}
	return ""
}
