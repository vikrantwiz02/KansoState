package pipeline

import "sync"

const defaultBufSize = 4096

// BufferPool is a sync.Pool of byte slices, avoiding allocations in the hot path.
type BufferPool struct {
	pool sync.Pool
}

// NewBufferPool creates a pool with the given initial buffer capacity.
func NewBufferPool(size int) *BufferPool {
	return &BufferPool{
		pool: sync.Pool{
			New: func() interface{} {
				b := make([]byte, 0, size)
				return &b
			},
		},
	}
}

// Get returns a zeroed buffer from the pool.
func (p *BufferPool) Get() *[]byte {
	b := p.pool.Get().(*[]byte)
	*b = (*b)[:0]
	return b
}

// Put returns a buffer to the pool.
func (p *BufferPool) Put(b *[]byte) {
	if cap(*b) > 1<<20 { // don't cache unusually large buffers
		return
	}
	p.pool.Put(b)
}
