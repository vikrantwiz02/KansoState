package server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// APIKeyAuth returns a middleware that requires a bearer token or X-Sentinel-Key header.
// If apiKey is empty the middleware is a no-op (dev mode).
// WebSocket upgrade requests may also pass the key via ?token= query param because
// browsers cannot set arbitrary headers during the WS handshake.
func APIKeyAuth(apiKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if apiKey == "" {
			c.Next()
			return
		}

		// Check Authorization: Bearer <key>
		if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			if strings.TrimPrefix(auth, "Bearer ") == apiKey {
				c.Next()
				return
			}
		}

		// Check X-Sentinel-Key header
		if c.GetHeader("X-Sentinel-Key") == apiKey {
			c.Next()
			return
		}

		// Check ?token= query param (WebSocket handshake fallback)
		if c.Query("token") == apiKey {
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	}
}
