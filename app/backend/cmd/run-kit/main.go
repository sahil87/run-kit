package main

import (
	"fmt"
	"net/http"
)

func main() {
	fmt.Println("run-kit")

	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	http.ListenAndServe(":3000", nil)
}
