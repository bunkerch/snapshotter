package schedule

import (
	"testing"
	"time"

	"github.com/manaf/restic-app/engine/domain"
)

func TestNextHourlyAlignsToClock(t *testing.T) {
	after := time.Date(2026, time.July, 10, 12, 43, 12, 0, time.UTC)
	next, err := Next(after, domain.Schedule{Enabled: true, Kind: domain.ScheduleHourly, Interval: 2})
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, time.July, 10, 14, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("got %v, want %v", next, want)
	}
}

func TestNextDailyMovesToTomorrowAfterTime(t *testing.T) {
	after := time.Date(2026, time.July, 10, 19, 0, 0, 0, time.Local)
	next, err := Next(after, domain.Schedule{Enabled: true, Kind: domain.ScheduleDaily, Hour: 18, Minute: 30})
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, time.July, 11, 18, 30, 0, 0, time.Local)
	if !next.Equal(want) {
		t.Fatalf("got %v, want %v", next, want)
	}
}

func TestNextDisabled(t *testing.T) {
	next, err := Next(time.Now(), domain.Schedule{Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	if !next.IsZero() {
		t.Fatalf("expected zero time, got %v", next)
	}
}
