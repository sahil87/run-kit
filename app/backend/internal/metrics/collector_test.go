package metrics

import (
	"context"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestNewCollector_InitializesRingBuffer(t *testing.T) {
	c := NewCollector(time.Second)
	snap := c.Snapshot()

	if len(snap.CPU.Samples) != ringSize {
		t.Errorf("expected %d samples, got %d", ringSize, len(snap.CPU.Samples))
	}

	// All samples should be zero on init
	for i, v := range snap.CPU.Samples {
		if v != 0 {
			t.Errorf("sample[%d] = %f, expected 0", i, v)
		}
	}
}

func TestNewCollector_HostnamePopulated(t *testing.T) {
	c := NewCollector(time.Second)
	snap := c.Snapshot()

	if snap.Hostname == "" {
		t.Error("expected non-empty hostname")
	}
}

func TestNewCollector_CoresPositive(t *testing.T) {
	c := NewCollector(time.Second)
	snap := c.Snapshot()

	if snap.CPU.Cores < 1 {
		t.Errorf("expected cores >= 1, got %d", snap.CPU.Cores)
	}
}

func TestCollector_SnapshotThreadSafety(t *testing.T) {
	c := NewCollector(50 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				snap := c.Snapshot()
				if len(snap.CPU.Samples) != ringSize {
					t.Errorf("unexpected sample count: %d", len(snap.CPU.Samples))
				}
				runtime.Gosched()
			}
		}()
	}
	wg.Wait()
	cancel()
}

func TestCollector_StartAndStop(t *testing.T) {
	c := NewCollector(50 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)

	// Let it poll a few times
	time.Sleep(200 * time.Millisecond)

	// Cancel and verify it doesn't panic
	cancel()

	// Small grace period for goroutine to exit
	time.Sleep(100 * time.Millisecond)

	// Snapshot should still work after stop (returns last known state)
	snap := c.Snapshot()
	if snap.Hostname == "" {
		t.Error("expected non-empty hostname after stop")
	}
}

func TestCollector_CollectsMetrics(t *testing.T) {
	c := NewCollector(50 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.Start(ctx)

	// Let it poll a few times
	time.Sleep(300 * time.Millisecond)

	snap := c.Snapshot()

	// On Linux, memory total should be positive
	if snap.Memory.Total == 0 {
		t.Error("expected non-zero memory total on Linux")
	}

	// Disk total should be positive
	if snap.Disk.Total == 0 {
		t.Error("expected non-zero disk total")
	}

	// Uptime should be positive
	if snap.UptimeSecs <= 0 {
		t.Error("expected positive uptime")
	}

	// Load CPUs should match cores
	if snap.Load.CPUs != snap.CPU.Cores {
		t.Errorf("load CPUs (%d) != CPU cores (%d)", snap.Load.CPUs, snap.CPU.Cores)
	}
}

func TestRingBuffer_Order(t *testing.T) {
	c := NewCollector(time.Second)

	// Manually insert some values
	for i := 0; i < 5; i++ {
		c.ringBuf[i] = float64(i + 1)
	}
	c.ringIdx = 5

	samples := c.samplesSnapshot()

	// First 5 should be 0 (positions 5-59 in ring), then 1,2,3,4,5
	// Wait, ringIdx=5 means next write goes to position 5.
	// samplesSnapshot reads from ringIdx onward: positions 5,6,...,59,0,1,2,3,4
	// Positions 5-59 are 0, positions 0-4 are 1-5
	for i := 0; i < ringSize-5; i++ {
		if samples[i] != 0 {
			t.Errorf("samples[%d] = %f, expected 0", i, samples[i])
		}
	}
	for i := 0; i < 5; i++ {
		expected := float64(i + 1)
		actual := samples[ringSize-5+i]
		if actual != expected {
			t.Errorf("samples[%d] = %f, expected %f", ringSize-5+i, actual, expected)
		}
	}
}

func TestSnapshot_DeepCopy(t *testing.T) {
	c := NewCollector(time.Second)

	// Manually trigger a collect to populate the snapshot
	c.ringBuf[0] = 42.0
	c.ringIdx = 1
	c.collect() // This updates c.snapshot from the current ringBuf state

	snap1 := c.Snapshot()

	// Mutate the ring buffer and re-collect
	c.ringBuf[0] = 99.0
	c.collect()

	snap2 := c.Snapshot()

	// snap1 should not have been affected by the second collect
	found42 := false
	for _, v := range snap1.CPU.Samples {
		if v == 42.0 {
			found42 = true
			break
		}
	}
	if !found42 {
		t.Error("expected snap1 to contain 42.0 somewhere in samples")
	}

	// Verify snap1 and snap2 don't share the same backing array
	snap1.CPU.Samples[0] = -1
	if snap2.CPU.Samples[0] == -1 {
		t.Error("snap1 and snap2 share the same samples backing array")
	}
}
