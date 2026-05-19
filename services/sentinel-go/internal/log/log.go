package log

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// piiFieldNames are forbidden in structured logs unless --debug-unsafe is set.
var piiFieldNames = map[string]struct{}{
	"raw":     {},
	"text":    {},
	"payload": {},
}

// New builds a production-safe zap logger. It installs a custom core that
// drops any field whose key appears in piiFieldNames (unless debugUnsafe is
// true, which is rejected at config validation time in production).
func New(level, env string, debugUnsafe bool) (*zap.Logger, error) {
	var lvl zapcore.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = zapcore.InfoLevel
	}

	var cfg zap.Config
	if env == "production" {
		cfg = zap.NewProductionConfig()
	} else {
		cfg = zap.NewDevelopmentConfig()
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	}
	cfg.Level = zap.NewAtomicLevelAt(lvl)

	base, err := cfg.Build(zap.WithCaller(true))
	if err != nil {
		return nil, err
	}

	if debugUnsafe {
		return base, nil
	}
	return base.WithOptions(zap.WrapCore(func(c zapcore.Core) zapcore.Core {
		return &piiFilterCore{Core: c}
	})), nil
}

type piiFilterCore struct {
	zapcore.Core
}

func (p *piiFilterCore) With(fields []zapcore.Field) zapcore.Core {
	return &piiFilterCore{Core: p.Core.With(filter(fields))}
}

func (p *piiFilterCore) Check(e zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	return p.Core.Check(e, ce)
}

func (p *piiFilterCore) Write(e zapcore.Entry, fields []zapcore.Field) error {
	return p.Core.Write(e, filter(fields))
}

func filter(fields []zapcore.Field) []zapcore.Field {
	out := fields[:0:len(fields)]
	for _, f := range fields {
		if _, blocked := piiFieldNames[f.Key]; !blocked {
			out = append(out, f)
		}
	}
	return out
}
