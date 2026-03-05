import pandas as pd
import json
import os

# Define the input and output file paths
input_file = 'events.xlsx'
output_dir = 'v0-flood-response-system/src/data'
output_file = os.path.join(output_dir, 'mockEvents.ts')

# Ensure the output directory exists
os.makedirs(output_dir, exist_ok=True)

try:
    # Read the Excel file
    df = pd.read_excel(input_file)

    # Convert the dataframe to a list of dictionaries
    events = df.to_dict(orient='records')

    # Format the data as a TypeScript export
    ts_content = "export const mockEvents = " + json.dumps(events, indent=2) + ";"

    # Write the content to the TypeScript file
    with open(output_file, 'w') as f:
        f.write(ts_content)

    print(f"Successfully extracted {len(events)} events to {output_file}")

except FileNotFoundError:
    print(f"Error: The file '{input_file}' was not found.")
except Exception as e:
    print(f"An error occurred: {e}")
