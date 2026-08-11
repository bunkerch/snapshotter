package config

import (
	"errors"
	"fmt"
	"strings"

	"github.com/restic/restic/app/domain"
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
	seenExclusions := make(map[string]bool, len(preferences.Exclusions))
	for _, exclusion := range preferences.Exclusions {
		if strings.TrimSpace(exclusion.ID) == "" || strings.TrimSpace(exclusion.Pattern) == "" {
			return errors.New("exclusion identifier and pattern are required")
		}
		if seenExclusions[exclusion.ID] {
			return fmt.Errorf("duplicate exclusion %q", exclusion.ID)
		}
		seenExclusions[exclusion.ID] = true
	}
	seenApps := make(map[string]bool, len(preferences.SelectedApps))
	for _, appID := range preferences.SelectedApps {
		if strings.TrimSpace(appID) == "" {
			return errors.New("application preset identifier is required")
		}
		if seenApps[appID] {
			return fmt.Errorf("duplicate application preset %q", appID)
		}
		seenApps[appID] = true
	}
	return nil
}

func validateSchedule(schedule domain.Schedule) error {
	switch schedule.Kind {
	case domain.ScheduleHourly:
		if schedule.Interval < 1 || schedule.Interval > 24 {
			return errors.New("hourly interval must be between 1 and 24")
		}
	case domain.ScheduleDaily, domain.ScheduleWeekly:
		if schedule.Hour < 0 || schedule.Hour > 23 || schedule.Minute < 0 || schedule.Minute > 59 {
			return errors.New("schedule time is invalid")
		}
		if schedule.Kind == domain.ScheduleWeekly && (schedule.Weekday < 0 || schedule.Weekday > 6) {
			return errors.New("weekly schedule weekday is invalid")
		}
	default:
		return fmt.Errorf("unsupported schedule kind %q", schedule.Kind)
	}
	return nil
}
