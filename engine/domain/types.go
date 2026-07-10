package domain

import "time"

type RepositoryKind string

const (
	RepositoryLocal RepositoryKind = "local"
	RepositorySFTP  RepositoryKind = "sftp"
	RepositoryS3    RepositoryKind = "s3"
	RepositoryREST  RepositoryKind = "rest"
)

type Repository struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Kind     RepositoryKind `json:"kind"`
	Location string         `json:"location"`
}

type Source struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	Enabled  bool   `json:"enabled"`
	Excluded bool   `json:"excluded"`
}

type RetentionPolicy struct {
	Hourly  int `json:"hourly"`
	Daily   int `json:"daily"`
	Weekly  int `json:"weekly"`
	Monthly int `json:"monthly"`
	Yearly  int `json:"yearly"`
}

type ScheduleKind string

const (
	ScheduleHourly ScheduleKind = "hourly"
	ScheduleDaily  ScheduleKind = "daily"
	ScheduleWeekly ScheduleKind = "weekly"
)

type Schedule struct {
	Enabled  bool         `json:"enabled"`
	Kind     ScheduleKind `json:"kind"`
	Interval int          `json:"interval"`
	Hour     int          `json:"hour"`
	Minute   int          `json:"minute"`
	Weekday  int          `json:"weekday"`
}

type Preferences struct {
	Version       int             `json:"version"`
	Repository    *Repository     `json:"repository,omitempty"`
	Sources       []Source        `json:"sources"`
	Schedule      Schedule        `json:"schedule"`
	Retention     RetentionPolicy `json:"retention"`
	LaunchAtLogin bool            `json:"launchAtLogin"`
}

func DefaultPreferences() Preferences {
	return Preferences{
		Version: 1,
		Sources: []Source{},
		Schedule: Schedule{
			Enabled:  true,
			Kind:     ScheduleDaily,
			Interval: 1,
			Hour:     9,
		},
		Retention: RetentionPolicy{
			Hourly:  24,
			Daily:   7,
			Weekly:  4,
			Monthly: 12,
		},
		LaunchAtLogin: true,
	}
}

type Snapshot struct {
	ID       string    `json:"id"`
	Time     time.Time `json:"time"`
	Hostname string    `json:"hostname"`
	Paths    []string  `json:"paths"`
	Tags     []string  `json:"tags"`
}

type Entry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Type    string    `json:"type"`
	Size    uint64    `json:"size"`
	ModTime time.Time `json:"modTime"`
}
