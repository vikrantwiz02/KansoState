package pipeline

import (
	"context"
	"runtime"
	"sync"
)

// WorkItem is the unit of work passed through the pipeline.
type WorkItem struct {
	Data    interface{}
	Done    func() // called when the item is fully processed (for backpressure)
}

// WorkerPool fans work out to N goroutines and collects results.
type WorkerPool struct {
	workers int
	in      chan WorkItem
	out     chan WorkItem
	wg      sync.WaitGroup
}

// NewWorkerPool creates a pool with runtime.NumCPU() workers by default.
func NewWorkerPool(workers, inBuf, outBuf int) *WorkerPool {
	if workers <= 0 {
		workers = runtime.NumCPU()
	}
	return &WorkerPool{
		workers: workers,
		in:      make(chan WorkItem, inBuf),
		out:     make(chan WorkItem, outBuf),
	}
}

// Start launches worker goroutines that apply fn to each item and forward results.
func (wp *WorkerPool) Start(ctx context.Context, fn func(WorkItem) WorkItem) {
	for i := 0; i < wp.workers; i++ {
		wp.wg.Add(1)
		go func() {
			defer wp.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case item, ok := <-wp.in:
					if !ok {
						return
					}
					result := fn(item)
					select {
					case wp.out <- result:
					case <-ctx.Done():
						return
					}
				}
			}
		}()
	}
}

// Submit sends a work item to the pool. Returns false if the context is done.
func (wp *WorkerPool) Submit(ctx context.Context, item WorkItem) bool {
	select {
	case wp.in <- item:
		return true
	case <-ctx.Done():
		return false
	}
}

// Results returns the output channel for processed items.
func (wp *WorkerPool) Results() <-chan WorkItem {
	return wp.out
}

// Stop drains and closes the input channel, then waits for workers to finish.
func (wp *WorkerPool) Stop() {
	close(wp.in)
	wp.wg.Wait()
	close(wp.out)
}
