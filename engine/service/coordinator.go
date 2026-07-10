package service

import (
	"context"
	"errors"
	"sync"
)

var ErrOperationInProgress = errors.New("repository operation already in progress")

type Coordinator struct {
	mu     sync.Mutex
	cancel context.CancelFunc
	runID  uint64
}

func (c *Coordinator) Start(parent context.Context) (context.Context, func(), error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		return nil, nil, ErrOperationInProgress
	}
	ctx, cancel := context.WithCancel(parent)
	c.cancel = cancel
	c.runID++
	runID := c.runID
	return ctx, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.runID == runID {
			c.cancel = nil
		}
	}, nil
}

func (c *Coordinator) Cancel() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
}
