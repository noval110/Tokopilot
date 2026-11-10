package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v5"

	"tokopilot/backend/internal/apperr"
)

var errBadJSON = apperr.New(http.StatusBadRequest, CodeValidation, "Format permintaan tidak valid.")

// DecodeJSON strictly decodes the request body into v. Unknown fields are
// rejected, so a client cannot smuggle e.g. "store_id" or "role" into a request.
func DecodeJSON(c *echo.Context, v any) error {
	dec := json.NewDecoder(c.Request().Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return apperr.New(http.StatusRequestEntityTooLarge, CodePayloadTooLarge, "Ukuran permintaan terlalu besar.")
		}
		return errBadJSON
	}
	if dec.More() {
		return errBadJSON
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errBadJSON
	}
	return nil
}

// Page is a validated page/per_page pair (BR-16).
type Page struct {
	Page    int
	PerPage int
}

func (p Page) Offset() int { return (p.Page - 1) * p.PerPage }

const (
	DefaultPerPage = 20
	MaxPerPage     = 100
)

// ParsePage reads ?page and ?per_page with defaults and an enforced maximum.
func ParsePage(c *echo.Context) (Page, error) {
	p := Page{Page: 1, PerPage: DefaultPerPage}
	fe := apperr.FieldErrors{}
	if s := c.QueryParam("page"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 {
			fe["page"] = "Halaman harus bilangan bulat ≥ 1."
		} else {
			p.Page = n
		}
	}
	if s := c.QueryParam("per_page"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > MaxPerPage {
			fe["per_page"] = "per_page harus antara 1 dan 100."
		} else {
			p.PerPage = n
		}
	}
	return p, apperr.Validation(fe)
}

// PageMeta is the pagination block of list responses.
type PageMeta struct {
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
	Total   int `json:"total"`
}
