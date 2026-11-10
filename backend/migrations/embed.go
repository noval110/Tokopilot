// Package migrations embeds the versioned SQL migrations into the binary so
// `api migrate up` runs exactly the files that were reviewed and built.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
