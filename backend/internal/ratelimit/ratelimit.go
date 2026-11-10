// Package ratelimit implements an in-memory fixed-window limiter. It is
// per-process, which is sufficient for the single-replica MVP (ADR-0008).
package ratelimit

import (
	"sync"
	"time"
)

type window struct {
	count int
	start time.Time
}

type Limiter struct {
	mu     sync.Mutex
	limit  int
	period time.Duration
	now    func() time.Time
	hits   map[string]*window
	sweep  time.Time
}

func New(limit int, period time.Duration, now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{limit: limit, period: period, now: now, hits: map[string]*window{}, sweep: now()}
}

// Blocked reports whether key has reached the limit, and how long until reset.
func (l *Limiter) Blocked(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.current(key)
	if w == nil || w.count < l.limit {
		return false, 0
	}
	return true, w.start.Add(l.period).Sub(l.now())
}

// Hit records one event for key.
func (l *Limiter) Hit(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.current(key)
	if w == nil {
		w = &window{start: l.now()}
		l.hits[key] = w
	}
	w.count++
}

// Allow records a hit and reports whether it is within the limit.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	if blocked, wait := l.Blocked(key); blocked {
		return false, wait
	}
	l.Hit(key)
	return true, 0
}

// Reset clears key (e.g. after a successful login).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

// current returns the live window for key, dropping expired ones. Caller holds mu.
func (l *Limiter) current(key string) *window {
	now := l.now()
	if now.Sub(l.sweep) > l.period {
		for k, w := range l.hits {
			if now.Sub(w.start) >= l.period {
				delete(l.hits, k)
			}
		}
		l.sweep = now
	}
	w := l.hits[key]
	if w != nil && now.Sub(w.start) >= l.period {
		delete(l.hits, key)
		return nil
	}
	return w
}
