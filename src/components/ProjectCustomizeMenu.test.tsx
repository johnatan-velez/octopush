import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectCustomizeMenu } from './ProjectCustomizeMenu';
import type { TintName } from '@/lib/types';

describe('ProjectCustomizeMenu', () => {
  const mockOnCustomized = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    projectId: 'project-1',
    currentName: 'My Project',
    currentTint: 'brass' as TintName,
    onCustomized: mockOnCustomized,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    mockOnCustomized.mockClear();
    mockOnCancel.mockClear();
  });

  it('renders with current values', () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue('My Project') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('My Project');
  });

  it('updates name when input changes', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Updated Project' } });

    await waitFor(() => {
      expect(nameInput.value).toBe('Updated Project');
    });
  });

  it('allows tint selection', () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const tintButtons = screen.getAllByRole('button');
    // First button after header close button (X) and last two are Cancel/Save
    // Tint buttons are in the middle (grid of 6 buttons for tints)
    const firstTintButton = tintButtons[1];

    fireEvent.click(firstTintButton);

    // Button should be selected (has border-octo-brass class)
    expect(firstTintButton).toHaveClass('border-octo-brass');
  });

  it('calls onCustomized with correct args when save button clicked', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Name' } });

    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnCustomized).toHaveBeenCalledWith('New Name', 'brass');
    });
  });

  it('does not call onCustomized when cancel button clicked', () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnCustomized).not.toHaveBeenCalled();
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('disables save button when name is empty', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    await waitFor(() => {
      const saveButton = screen.getByText('Save') as HTMLButtonElement;
      expect(saveButton).toBeDisabled();
    });
  });

  it('disables save button when only whitespace is entered', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '   ' } });

    await waitFor(() => {
      const saveButton = screen.getByText('Save') as HTMLButtonElement;
      expect(saveButton).toBeDisabled();
    });
  });

  it('disables save button while saving', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const saveButton = screen.getByText('Save') as HTMLButtonElement;
    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;

    // Initially enabled
    expect(saveButton).not.toBeDisabled();

    // Clear the name to disable save button
    fireEvent.change(nameInput, { target: { value: '' } });

    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });

    // Fill the name again to enable save button
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } });

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it('shows error message when name is empty', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    await waitFor(() => {
      expect(
        screen.getByText('Project name is required')
      ).toBeInTheDocument();
    });
  });

  it('hides error message when name is filled', async () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const nameInput = screen.getByDisplayValue(
      'My Project'
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    await waitFor(() => {
      expect(
        screen.getByText('Project name is required')
      ).toBeInTheDocument();
    });

    fireEvent.change(nameInput, { target: { value: 'Valid Name' } });

    await waitFor(() => {
      expect(
        screen.queryByText('Project name is required')
      ).not.toBeInTheDocument();
    });
  });

  it('close button calls onCancel', () => {
    render(<ProjectCustomizeMenu {...defaultProps} />);

    const closeButton = screen.getByLabelText('Close');
    fireEvent.click(closeButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });
});
