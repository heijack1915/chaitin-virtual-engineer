package safeline

// extractData safely extracts the "data" field from a response
func extractData(resp *SLResponse) interface{} {
	if resp == nil || resp.Data == nil {
		return nil
	}
	return resp.Data
}
