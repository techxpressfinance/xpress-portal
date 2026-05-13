import AddLead from '../referrer/AddLead';

export default function CreateApplication() {
  return (
    <AddLead
      basePath="/admin/applications"
      title="New Application"
      submitLabel="Create Application"
      skipEngagement
      showFullDetails
    />
  );
}
