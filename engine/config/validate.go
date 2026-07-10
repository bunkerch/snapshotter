package config

import (
	"errors"
	"fmt"
	"strings"

	"github.com/manaf/restic-app/engine/domain"
)

func Validate(preferences domain.Preferences) error {
	if preferences.Version != 1 {
		return fmt.Errorf("unsupported preferences version %d", preferences.Version)
	}
	if err := validateSchedule(preferences.Schedule); err != nil {
		return err
	}
	if preferences.Repository != nil {
		if strings.TrimSpace(preferences.Repository.Name) == "" {
			return errors.New("repository name is required")
		}
		if strings.TrimSpace(preferences.Repository.Location) == "" {
			return errors.New("repository location is required")
		}
	}
	for _, source := range preferences.Sources {
		if strings.TrimSpace(source.Path) == "" {
			return errors.New("source path is required")
		}
	}
	return nil
}

func validateSchedule(schedule domain.Schedule) error {
	switch schedule.Kind {
	case domain.ScheduleHourly:
		if schedule.Interval < 1 || schedule.Interval > 24 {
			return errors.New("hourly interval must be between 1 and 24")
		}
	case domain.ScheduleDaily:
		if schedule.Hour < 0 || schedule.Hour > 23 || schedule.Minute < 0 || schedule.Minute > 59 {
			return errors.New("daily schedule time is invalid")
		}
	default:
		return fmt.Errorf("unsupported schedule kind %q", schedule.Kind)
	}
	return nil
}
