package service

import (
	"context"
	"io"

	"github.com/restic/restic/app/domain"
)

// Engine is the application-facing contract implemented by the embedded restic adapter.
// Passwords are supplied per operation by the configured secret-storage provider.
type Engine interface {
	Initialize(context.Context, domain.Repository, domain.RepositoryCredentials, []byte) error
	Unlock(context.Context, domain.Repository, domain.RepositoryCredentials, []byte) error
	Backup(context.Context, []domain.Source, []domain.Exclusion, ProgressSink) (domain.Snapshot, error)
	Snapshots(context.Context) ([]domain.Snapshot, error)
	List(context.Context, string, string) ([]domain.Entry, error)
	Dump(context.Context, string, string, io.Writer) error
	Forget(context.Context, domain.RetentionPolicy) error
	DeleteSnapshot(context.Context, string) error
	Check(context.Context, ProgressSink) error
	RepairIndex(context.Context, ProgressSink) error
	Close() error
}

type Progress struct {
	Phase      string  `json:"phase"`
	FilesDone  uint64  `json:"filesDone"`
	FilesTotal uint64  `json:"filesTotal"`
	BytesDone  uint64  `json:"bytesDone"`
	BytesTotal uint64  `json:"bytesTotal"`
	Fraction   float64 `json:"fraction"`
}

type ProgressSink func(Progress)
