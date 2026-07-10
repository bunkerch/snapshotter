# Restic embedding

Restic is linked as a Go module. The application does not invoke or bundle the
restic CLI.

Restic's operational packages, including repository and archiver, are under its
Go `internal` directory. Go only permits importing those packages from code whose
module path is within `github.com/restic/restic`. For that reason, the engine uses
the module path `github.com/restic/restic/app` while the product repository remains
independent. This is an import-visibility requirement, not a claim that the app is
an official restic project.

The dependency is pinned to an exact restic release. Restic types remain private
to `resticadapter`; the rest of the app depends on the stable domain and service
interfaces. Upgrades can therefore be reviewed and tested in one package.
