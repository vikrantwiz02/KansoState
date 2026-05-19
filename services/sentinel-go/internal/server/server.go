package server

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
)

// Server holds the Gin engine and its HTTP server.
type Server struct {
	engine *gin.Engine
	http   *http.Server
	log    *zap.Logger
}

// Config holds Gin server parameters.
type Config struct {
	Addr           string
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
	IdleTimeout    time.Duration
	APIKey         string
	AllowedOrigins []string
}

// New assembles the Gin router and mounts all handlers.
func New(cfg Config, hs hotStore, pi ingestor, log *zap.Logger) *Server {
	if cfg.Addr == "" {
		cfg.Addr = ":8080"
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger(log))

	// Health and metrics are always public.
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "ts": time.Now().UTC()})
	})
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// All product endpoints require the API key when one is configured.
	auth := APIKeyAuth(cfg.APIKey)
	r.GET("/ws", auth, WSRateLimit(5, 1), WSHandler(pi, cfg.AllowedOrigins, log))
	r.GET("/sse", auth, SSEHandler(hs, log))
	r.GET("/api/v1/meetings", auth, ListMeetingsHandler(hs, log))
	r.GET("/api/v1/meetings/:id/hydrate", auth, ReadAPIHandler(hs, log))

	// WebRTC signaling — one room per meeting, peers relay SDP/ICE through sentinel.
	sigHub := NewSignalHub()
	r.GET("/ws/signal", auth, sigHub.Handler(cfg.AllowedOrigins, log))

	return &Server{
		engine: r,
		http: &http.Server{
			Addr:         cfg.Addr,
			Handler:      r,
			ReadTimeout:  cfg.ReadTimeout,
			WriteTimeout: cfg.WriteTimeout,
			IdleTimeout:  cfg.IdleTimeout,
		},
		log: log,
	}
}

// Start begins listening. Blocks until Shutdown is called.
func (s *Server) Start() error {
	s.log.Info("server: listening", zap.String("addr", s.http.Addr))
	return s.http.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func requestLogger(log *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info("http",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("latency", time.Since(start)),
		)
	}
}
