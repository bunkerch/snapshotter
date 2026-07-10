package schedule

import (
	"fmt"
	"time"

	"github.com/restic/restic/app/domain"
)

func Next(after time.Time, configured domain.Schedule) (time.Time, error) {
	if !configured.Enabled {
		return time.Time{}, nil
	}

	switch configured.Kind {
	case domain.ScheduleHourly:
		if configured.Interval < 1 || configured.Interval > 24 {
			return time.Time{}, fmt.Errorf("invalid hourly interval %d", configured.Interval)
		}
		return after.Truncate(time.Hour).Add(time.Duration(configured.Interval) * time.Hour), nil
	case domain.ScheduleDaily:
		if configured.Hour < 0 || configured.Hour > 23 || configured.Minute < 0 || configured.Minute > 59 {
			return time.Time{}, fmt.Errorf("invalid daily time %02d:%02d", configured.Hour, configured.Minute)
		}
		next := time.Date(after.Year(), after.Month(), after.Day(), configured.Hour, configured.Minute, 0, 0, after.Location())
		if !next.After(after) {
			next = next.AddDate(0, 0, 1)
		}
		return next, nil
	default:
		return time.Time{}, fmt.Errorf("unsupported schedule kind %q", configured.Kind)
	}
}
