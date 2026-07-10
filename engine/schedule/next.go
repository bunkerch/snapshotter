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
	case domain.ScheduleWeekly:
		if configured.Weekday < 0 || configured.Weekday > 6 || configured.Hour < 0 || configured.Hour > 23 || configured.Minute < 0 || configured.Minute > 59 {
			return time.Time{}, fmt.Errorf("invalid weekly schedule")
		}
		daysAhead := (configured.Weekday - int(after.Weekday()) + 7) % 7
		next := time.Date(after.Year(), after.Month(), after.Day(), configured.Hour, configured.Minute, 0, 0, after.Location()).AddDate(0, 0, daysAhead)
		if !next.After(after) {
			next = next.AddDate(0, 0, 7)
		}
		return next, nil
	default:
		return time.Time{}, fmt.Errorf("unsupported schedule kind %q", configured.Kind)
	}
}

func Due(now, lastBackup time.Time, configured domain.Schedule) (bool, time.Time, error) {
	if !configured.Enabled {
		return false, time.Time{}, nil
	}
	var scheduled time.Time
	switch configured.Kind {
	case domain.ScheduleHourly:
		if configured.Interval < 1 || configured.Interval > 24 {
			return false, time.Time{}, fmt.Errorf("invalid hourly interval %d", configured.Interval)
		}
		scheduled = now.Truncate(time.Hour)
	case domain.ScheduleDaily:
		if configured.Hour < 0 || configured.Hour > 23 || configured.Minute < 0 || configured.Minute > 59 {
			return false, time.Time{}, fmt.Errorf("invalid daily time")
		}
		scheduled = time.Date(now.Year(), now.Month(), now.Day(), configured.Hour, configured.Minute, 0, 0, now.Location())
		if scheduled.After(now) {
			scheduled = scheduled.AddDate(0, 0, -1)
		}
	case domain.ScheduleWeekly:
		if configured.Weekday < 0 || configured.Weekday > 6 || configured.Hour < 0 || configured.Hour > 23 || configured.Minute < 0 || configured.Minute > 59 {
			return false, time.Time{}, fmt.Errorf("invalid weekly schedule")
		}
		daysBack := (int(now.Weekday()) - configured.Weekday + 7) % 7
		scheduled = time.Date(now.Year(), now.Month(), now.Day(), configured.Hour, configured.Minute, 0, 0, now.Location()).AddDate(0, 0, -daysBack)
		if scheduled.After(now) {
			scheduled = scheduled.AddDate(0, 0, -7)
		}
	default:
		return false, time.Time{}, fmt.Errorf("unsupported schedule kind %q", configured.Kind)
	}
	return lastBackup.IsZero() || lastBackup.Before(scheduled), scheduled, nil
}
