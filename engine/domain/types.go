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
