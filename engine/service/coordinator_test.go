package service

import (
	"context"
	"testing"
)

func TestCoordinatorCancelsActiveOperation(t *testing.T) {
	var coordinator Coordinator
	ctx, done, err := coordinator.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer done()

	if !coordinator.Cancel() {
		t.Fatal("active operation was not cancelled")
	}
	if err := ctx.Err(); err != context.Canceled {
		t.Fatalf("operation context error = %v, want context.Canceled", err)
	}
	if !coordinator.Cancel() {
		t.Fatal("operation should remain active until completion")
	}
	done()
	if coordinator.Cancel() {
		t.Fatal("completed operation was still active")
	}
}

func TestCoordinatorWaitsForCancelledOperationToFinish(t *testing.T) {
	var coordinator Coordinator
	_, firstDone, err := coordinator.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !coordinator.Cancel() {
		t.Fatal("active operation was not cancelled")
	}

	if _, _, err := coordinator.Start(context.Background()); err != ErrOperationInProgress {
		t.Fatalf("start during cancellation = %v, want ErrOperationInProgress", err)
	}
	firstDone()

	secondContext, secondDone, err := coordinator.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer secondDone()
	if !coordinator.Cancel() {
		t.Fatal("second operation was not active")
	}
	if err := secondContext.Err(); err != context.Canceled {
		t.Fatalf("second operation context error = %v, want context.Canceled", err)
	}
}
